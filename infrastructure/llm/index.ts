import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * Model tiers per docs/architecture/04. Currently backed by Gemini's free
 * tier; swapping to Claude later means changing only this file.
 * Returns null when no provider key is configured — callers fall back to
 * the built-in mock stream so the app works keyless.
 *
 * ── Key rotation ───────────────────────────────────────────────────────────
 * The free tier is metered per key, per minute and per day, and SAGE burns
 * through it: every chat turn, voice turn, briefing, synthesis, automation and
 * report is a call. On one key the whole system goes quiet for the rest of the
 * day the moment it runs dry.
 *
 * Several keys are rotated round-robin, and a key that reports quota trouble
 * is set aside rather than retried into the ground. All of this lives here on
 * purpose — there are thirty-odd call sites and none of them should have to
 * know about it.
 */
export type ModelTier = "fast" | "smart";

/** Every configured key, across the singular and plural env vars. */
export function googleKeys(): string[] {
  const raw = `${process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ""},${process.env.GOOGLE_GENERATIVE_AI_API_KEYS ?? ""}`;
  return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

/** key → epoch ms until which it is considered spent. */
const cooldown = new Map<string, number>();
/** Per-minute limits recover quickly; a daily cap does not. Start short and
 *  escalate, so a burst does not sideline a key for hours. */
const strikes = new Map<string, number>();
/** When each key was last penalised. The SDK retries a failed call three times
 *  internally, and every retry surfaces here — without this, a single quota
 *  refusal counted as three strikes and sent a key from one minute straight to
 *  twenty-five. */
const lastPenalty = new Map<string, number>();
const STRIKE_DEBOUNCE_MS = 15_000;

/**
 * Where this instance starts in the key list.
 *
 * Serverless has no shared memory: every cold start gets a fresh copy of this
 * module, so a cursor initialised to 0 meant every new instance began at key
 * one. Under real traffic — which is mostly cold starts — that is not
 * round-robin at all, it is "hammer the first key and barely touch the rest",
 * which is exactly how one key hits its daily cap while four sit idle.
 * Starting at a random offset spreads cold starts evenly across the keys.
 */
let cursor = Math.floor(Math.random() * 1000);

function healthyKeys(): string[] {
  const now = Date.now();
  const all = googleKeys();
  const live = all.filter((k) => (cooldown.get(k) ?? 0) <= now);
  // Everything is cooling: rather than fail outright, use whichever recovers
  // soonest — a 429 is a better answer than pretending there is no model.
  if (live.length === 0 && all.length > 0) {
    return [all.slice().sort((a, b) => (cooldown.get(a) ?? 0) - (cooldown.get(b) ?? 0))[0]];
  }
  return live;
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /quota|429|RESOURCE_EXHAUSTED|rate.?limit|exceeded your current/i.test(msg);
}

function penalise(key: string) {
  const now = Date.now();
  const repeat = now - (lastPenalty.get(key) ?? 0) < STRIKE_DEBOUNCE_MS;
  lastPenalty.set(key, now);
  // One logical failure, however many times the SDK retried it underneath.
  if (repeat) return;

  const n = (strikes.get(key) ?? 0) + 1;
  strikes.set(key, n);
  // 1 min → 5 → 25 → 2h, capped. Three strikes running is a daily cap rather
  // than a burst, and hammering it only wastes the other keys' turn.
  const mins = Math.min(120, 5 ** (n - 1));
  cooldown.set(key, now + mins * 60_000);
}

function build(key: string, tier: ModelTier): LanguageModel {
  const google = createGoogleGenerativeAI({ apiKey: key });
  return tier === "fast" ? google("gemini-2.5-flash-lite") : google("gemini-2.5-flash");
}

/**
 * Wrap the model so a quota failure sidelines the key that caused it AND is
 * retried on the next healthy key, without every caller having to know.
 *
 * The sidelining alone was not enough. A 429 on the one key this call happened
 * to draw was thrown straight at the caller, so a briefing or a research run
 * failed outright while four other keys sat healthy and unused — the whole
 * point of holding several keys. Failing over in here fixes every one of the
 * thirty-odd call sites at once.
 *
 * The SDK reaches the model through doGenerate/doStream, so intercepting those
 * covers every path.
 */
function observed(first: string, tier: ModelTier): LanguageModel {
  const target = build(first, tier) as unknown as Record<string, unknown>;

  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if ((prop !== "doGenerate" && prop !== "doStream") || typeof value !== "function") {
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(obj) : value;
      }

      return async (...args: unknown[]) => {
        // Each key gets at most one turn, so a total outage still terminates.
        const tried = new Set<string>();
        let key = first;
        let impl = obj;
        let lastErr: unknown;

        for (let attempt = 0; attempt < Math.max(1, googleKeys().length); attempt++) {
          tried.add(key);
          try {
            const fn = Reflect.get(impl, prop) as (...a: unknown[]) => Promise<unknown>;
            const out = await fn.apply(impl, args);
            strikes.delete(key); // a clean call clears the record
            return out;
          } catch (err) {
            lastErr = err;
            if (!isQuotaError(err)) throw err;   // a real error is not a key problem
            penalise(key);

            const next = healthyKeys().find((k) => !tried.has(k));
            if (!next) throw err;
            key = next;
            impl = build(next, tier) as unknown as Record<string, unknown>;
          }
        }
        throw lastErr;
      };
    },
  }) as unknown as LanguageModel;
}

export function getModel(tier: ModelTier = "smart"): LanguageModel | null {
  const keys = healthyKeys();
  if (keys.length === 0) return null;

  // Round-robin per call. With N keys that is the whole point: N times the
  // free-tier headroom, spread evenly rather than draining one at a time.
  const key = keys[cursor++ % keys.length];
  return observed(key, tier);
}

/** Key health, for diagnostics. Never returns key material — tail only. */
export function modelKeyStatus() {
  const now = Date.now();
  return googleKeys().map((k, i) => ({
    index: i + 1,
    tail: `…${k.slice(-4)}`,
    healthy: (cooldown.get(k) ?? 0) <= now,
    cooldownSeconds: Math.max(0, Math.round(((cooldown.get(k) ?? 0) - now) / 1000)),
  }));
}
