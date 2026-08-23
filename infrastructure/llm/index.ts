import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { TZ } from "@/lib/config";

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
 * One key is used until it is actually spent, and only then is the next one
 * taken up; a key that reports quota trouble is set aside rather than retried
 * into the ground. All of this lives here on purpose — there are thirty-odd
 * call sites and none of them should have to know about it.
 */
export type ModelTier = "fast" | "smart";

/**
 * Model ids, newest first.
 *
 * Google retires model names, and a retired name fails with "no longer
 * available to new users" — which is not a quota problem, so the key failover
 * cannot help and every AI feature in the app dies at once. That is exactly
 * what happened to gemini-2.5-flash, and then to gemini-2.0-flash.
 *
 * So each tier is a list rather than a name, tried in order, and the `-latest`
 * aliases lead because Google repoints them as models turn over. An id can be
 * pinned with GOOGLE_MODEL_SMART / GOOGLE_MODEL_FAST when a specific version
 * is wanted, without a deploy.
 *
 * ── Keep a live id at the end ──────────────────────────────────────────────
 *
 * The failover handled the 2.0-flash retirement exactly as designed: it caught
 * the model error and advanced. It still failed, because 2.0-flash was the
 * LAST entry, so advancing ran off the end of the list. A list whose tail is a
 * retired id has no fallback at all — the whole mechanism depends on there
 * being somewhere left to go. Retired ids are removed here rather than left in
 * place, since each one also wastes a round trip before the list moves on.
 */
const MODEL_IDS: Record<ModelTier, string[]> = {
  smart: [
    ...(process.env.GOOGLE_MODEL_SMART ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    "gemini-flash-latest",
    // Named by Google's own retirement notice for 2.0-flash. Behind the alias
    // deliberately: if `-latest` already points here, this is never reached,
    // and if Google moves on again the alias keeps working without a deploy.
    "gemini-3.6-flash",
    "gemini-2.5-flash",
  ],
  fast: [
    ...(process.env.GOOGLE_MODEL_FAST ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    "gemini-flash-lite-latest",
    // Inferred sibling of gemini-3.6-flash — Google names the lite tier this
    // way, but unlike the id above it was not confirmed by a retirement
    // notice. Safe to list regardless: an id that does not exist fails as a
    // model error and the list simply advances past it.
    "gemini-3.6-flash-lite",
    "gemini-2.5-flash-lite",
  ],
};

/**
 * Which id worked last, per tier. Once one answers, stop paying the cost of
 * discovering it again on every call.
 */
const chosen = new Map<ModelTier, string>();

/** A retired or misspelt model id — the fix is another id, not another key. */
export function isModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no longer available|not found|not supported|unsupported model|404|does not exist|invalid model/i.test(msg);
}

/**
 * Keys added from Settings, cached per instance.
 *
 * The point of storing keys in the database is that a dead one can be replaced
 * without a redeploy, so this cache has to expire — but reading it on every
 * model call would put a database round trip in front of every reply. A minute
 * is the compromise: fast enough that a newly pasted key works while he is
 * still looking at the screen, cheap enough to be free.
 */
let stored: string[] = [];
let storedAt = 0;
/** Has this instance ever successfully looked? Distinguishes "none" from "not yet". */
let storedChecked = false;
const KEY_TTL_MS = 60_000;
let refreshing: Promise<void> | null = null;

function envKeys(): string[] {
  const raw = `${process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ""},${process.env.GOOGLE_GENERATIVE_AI_API_KEYS ?? ""}`;
  return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

/** Re-read the stored keys, at most one in flight at a time. */
export async function refreshKeys(force = false): Promise<void> {
  if (!force && storedChecked && Date.now() - storedAt < KEY_TTL_MS) return;
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const { keysFor } = await import("@/core/ops/keys");
      stored = await keysFor("google");
    } catch {
      // A database that cannot be read must not lose him the env keys.
      stored = [];
    } finally {
      storedAt = Date.now();
      storedChecked = true;
      refreshing = null;
    }
  })();

  return refreshing;
}

/** Called after a key is added or removed, so the change lands immediately. */
export function invalidateKeys(): void {
  storedAt = 0;
}

/**
 * Every configured key: the environment first, then anything added in Settings.
 *
 * Env keys lead deliberately. They are the ones that were there before this
 * existed, and a stable order means the sticky choice does not jump around
 * between instances any more than it must.
 */
export function googleKeys(): string[] {
  return [...new Set([...envKeys(), ...stored])];
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
 * one — "hammer the first key and barely touch the rest", which is exactly how
 * one key hits its daily cap while four sit idle. A random offset spreads cold
 * starts across the keys; it decides only where an instance *begins*.
 */
let cursor = Math.floor(Math.random() * 1000);

/**
 * The key this instance is currently working through.
 *
 * Rotation only on exhaustion, per Gyaan. The alternative — a fresh key every
 * call — spreads load evenly but leaves every key partly spent, so there is
 * never a clean answer to "which of these still has room". Sticking to one
 * until it is actually out keeps the spending legible: keys are consumed in
 * order, and modelKeyStatus shows how far down the list you are.
 *
 * "Spent" is not a guess. A key moves only when it has refused on quota and
 * been put on cooldown by penalise(), which is the same signal the in-flight
 * failover uses — so a burst never costs a key its turn, and a genuinely
 * exhausted one is never asked twice.
 */
let current: string | null = null;

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

export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /quota|429|RESOURCE_EXHAUSTED|rate.?limit|exceeded your current/i.test(msg);
}

/**
 * The model is up, it is just busy.
 *
 * "This model is currently experiencing high demand" is Google shedding load —
 * a 503, not a 429. It matched neither isModelError nor isQuotaError, so the
 * failover below took the `throw err` branch reserved for real errors and gave
 * up on the first refusal. The SDK's own retry then repeated the same call, on
 * the same key, against the same overloaded model three times and surfaced
 * "Failed after 3 attempts" — which is how the research agent came to fail
 * every single time while four healthy keys sat unused.
 *
 * This is the most retryable failure there is, and it was the only one not
 * being retried.
 */
export function isOverloadedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /high demand|overloaded|503|UNAVAILABLE|temporarily unavailable|try again later|capacity/i.test(msg);
}

/** How many times one call may ride out an overload before giving up. */
const OVERLOAD_RETRIES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A key that has behaved for an hour is not on its third strike any more.
 *
 * This matters more now that one key takes all the traffic until it is spent:
 * it will brush the per-minute limit several times across a day, and without
 * decay those unrelated bursts would compound into a two-hour sideline for
 * what is really a sixty-second problem. Strikes are meant to distinguish a
 * burst from a daily cap, and a daily cap does not go quiet for an hour.
 */
const STRIKE_DECAY_MS = 60 * 60_000;

function penalise(key: string) {
  const now = Date.now();
  const repeat = now - (lastPenalty.get(key) ?? 0) < STRIKE_DEBOUNCE_MS;
  const since = now - (lastPenalty.get(key) ?? 0);
  lastPenalty.set(key, now);
  // One logical failure, however many times the SDK retried it underneath.
  if (repeat) return;

  if (since > STRIKE_DECAY_MS) strikes.delete(key);

  const n = (strikes.get(key) ?? 0) + 1;
  strikes.set(key, n);
  // 1 min → 5 → 25 → 2h, capped. Three strikes running is a daily cap rather
  // than a burst, and hammering it only wastes the other keys' turn.
  const mins = Math.min(120, 5 ** (n - 1));
  cooldown.set(key, now + mins * 60_000);
}

function build(key: string, tier: ModelTier, modelId: string): LanguageModel {
  return createGoogleGenerativeAI({ apiKey: key })(modelId);
}

/** The ids to try for a tier, best-known-good first. */
function idsFor(tier: ModelTier): string[] {
  const all = MODEL_IDS[tier];
  const known = chosen.get(tier);
  return known ? [known, ...all.filter((id) => id !== known)] : all;
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
function observed(first: string | null, tier: ModelTier): LanguageModel {
  // A placeholder key when none is known yet: the object is only built so the
  // SDK has something with the right shape to call into, and the real key is
  // resolved below before anything is sent.
  const target = build(first ?? "pending", tier, idsFor(tier)[0]) as unknown as Record<string, unknown>;

  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if ((prop !== "doGenerate" && prop !== "doStream") || typeof value !== "function") {
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(obj) : value;
      }

      return async (...args: unknown[]) => {
        // Each key gets at most one turn, and each model id at most one pass,
        // so a total outage still terminates instead of spinning.
        const ids = idsFor(tier);
        let idIndex = 0;
        let impl = obj;
        let lastErr: unknown;

        // Resolve the key now if getModel could not. This is the async moment
        // the synchronous entry point did not have.
        let key = first;
        if (!key) {
          await refreshKeys(true);
          key = healthyKeys()[0] ?? null;
          if (!key) {
            throw new Error(
              "No AI key configured. Add one in Settings → Vitals, or set GOOGLE_GENERATIVE_AI_API_KEY.",
            );
          }
          impl = build(key, tier, ids[0]) as unknown as Record<string, unknown>;
        }

        const triedKeys = new Set<string>();

        const budget = Math.max(1, googleKeys().length) + ids.length + OVERLOAD_RETRIES;
        let overloads = 0;
        // A retired id is a permanent move and worth remembering; an overload
        // is a blip, and sticking the tier to an older model because Google
        // was busy for two seconds would quietly downgrade every later call.
        let movedForOverload = false;

        for (let attempt = 0; attempt < budget; attempt++) {
          triedKeys.add(key);
          try {
            const fn = Reflect.get(impl, prop) as (...a: unknown[]) => Promise<unknown>;
            const out = await fn.apply(impl, args);
            strikes.delete(key);                              // a clean call clears the record
            if (!movedForOverload) chosen.set(tier, ids[idIndex]); // remember what actually works
            noteCall(tier, true);
            return out;
          } catch (err) {
            lastErr = err;
            noteCall(tier, false);

            // A retired model id fails on every key, so rotating keys would
            // just burn the ring. Move to the next id instead.
            if (isModelError(err)) {
              idIndex += 1;
              if (idIndex >= ids.length) throw err;
              impl = build(key, tier, ids[idIndex]) as unknown as Record<string, unknown>;
              continue;
            }

            /**
             * Busy, not spent. The key is fine and the model id is fine, so
             * penalising either would be wrong — sidelining a healthy key for
             * an hour because Google was briefly loaded is how one blip turns
             * into an afternoon with no AI at all.
             *
             * Wait, then prefer a *different* model id: "this model is
             * overloaded" is the one failure where another model is the
             * obviously right answer. When the ids run out, keep retrying the
             * last one on the backoff until the budget is gone.
             */
            if (isOverloadedError(err)) {
              overloads += 1;
              if (overloads > OVERLOAD_RETRIES) throw err;
              // 400ms, 800, 1600, 3200 — with jitter, so several callers
              // riding out the same blip do not come back in lockstep.
              await sleep(400 * 2 ** (overloads - 1) * (0.75 + Math.random() * 0.5));
              if (idIndex + 1 < ids.length) {
                idIndex += 1;
                movedForOverload = true;
              }
              impl = build(key, tier, ids[idIndex]) as unknown as Record<string, unknown>;
              continue;
            }

            if (!isQuotaError(err)) throw err;   // a real error is not a key problem
            penalise(key);

            const next = healthyKeys().find((k) => !triedKeys.has(k));
            if (!next) throw err;
            key = next;
            // The call that discovers a key is spent is also the one that
            // moves on from it. Without this the next getModel() would hand
            // out the dead key again and rediscover the same 429.
            current = next;
            impl = build(next, tier, ids[idIndex]) as unknown as Record<string, unknown>;
          }
        }
        throw lastErr;
      };
    },
  }) as unknown as LanguageModel;
}

export function getModel(tier: ModelTier = "smart"): LanguageModel | null {
  // Keep the cache warm without waiting for it: this is a synchronous function
  // called from forty-odd places, and none of them should grow an await.
  void refreshKeys();

  const keys = healthyKeys();

  if (keys.length === 0) {
    // Nothing in the environment and nothing stored, confirmed: there really
    // is no model, and every caller already handles that honestly.
    if (storedChecked) return null;

    // Not confirmed. This is a cold instance that has not read the stored keys
    // yet — returning null here would tell him "no AI configured" purely
    // because the first request of the day arrived before the first database
    // read finished. The proxy resolves the key when the call is actually
    // made, which is async and can wait.
    return observed(null, tier);
  }

  // Stay on the current key while it is still healthy. It stops being healthy
  // only by being penalised for quota, which is what "used up" means here.
  if (current && keys.includes(current)) return observed(current, tier);

  // Moving on. The offset only matters for the first pick after a cold start —
  // without it every fresh instance would begin at key one and drain it first.
  current = keys[cursor++ % keys.length];
  return observed(current, tier);
}

/**
 * Counting what SAGE spends.
 *
 * Google exposes no usage API for the free tier, so the only way to answer
 * "how much is left today" is to count our own calls. Without this, an app
 * that has gone quiet is indistinguishable from an app that is broken — which
 * is the actual problem: a quota wall looks exactly like a bug.
 *
 * Counters are per-instance and flushed into a single row per day, at most
 * once a minute, so the cost of knowing is a couple of writes an hour rather
 * than a write per model call. Serverless instances come and go, so the row is
 * incremented from a stored total rather than overwritten with a local one.
 */
interface Usage { calls: number; failures: number; byTier: Record<string, number> }
const pending: Usage = { calls: 0, failures: 0, byTier: {} };
let lastFlush = 0;
const FLUSH_EVERY_MS = 60_000;

function noteCall(tier: ModelTier, ok: boolean) {
  pending.calls += 1;
  if (!ok) pending.failures += 1;
  pending.byTier[tier] = (pending.byTier[tier] ?? 0) + 1;
  if (Date.now() - lastFlush > FLUSH_EVERY_MS) void flushUsage();
}

async function flushUsage(): Promise<void> {
  if (pending.calls === 0) return;
  lastFlush = Date.now();
  const batch = { ...pending, byTier: { ...pending.byTier } };
  pending.calls = 0; pending.failures = 0; pending.byTier = {};

  try {
    const { db, DEFAULT_USER_ID } = await import("@/infrastructure/db/supabase");
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    const { data: existing } = await db
      .from("Event").select("id, payload")
      .eq("userId", DEFAULT_USER_ID).eq("type", "llm.usage").eq("payload->>day", day)
      .limit(1).maybeSingle();

    const prev = (existing?.payload as Usage | undefined) ?? { calls: 0, failures: 0, byTier: {} };
    const merged: Usage & { day: string } = {
      day,
      calls: prev.calls + batch.calls,
      failures: prev.failures + batch.failures,
      byTier: { ...prev.byTier },
    };
    for (const [t, n] of Object.entries(batch.byTier)) merged.byTier[t] = (merged.byTier[t] ?? 0) + n;

    if (existing) await db.from("Event").update({ payload: merged }).eq("id", existing.id);
    else await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "llm.usage", payload: merged });
  } catch {
    // Losing a counter is not worth failing a reply over.
  }
}

/** Today's spend, and the days before it, for the vitals panel. */
export async function usageHistory(days = 7): Promise<{ day: string; calls: number; failures: number }[]> {
  const { db, DEFAULT_USER_ID } = await import("@/infrastructure/db/supabase");
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", "llm.usage")
    .order("createdAt", { ascending: false }).limit(days);
  const rows = (data ?? []).map((r) => r.payload as Usage & { day: string });
  // The in-flight batch has not been written yet; today's number should still
  // include it, or the panel reads low every time you look at it.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const out = rows.map((r) => ({ day: r.day, calls: r.calls, failures: r.failures }));
  const mine = out.find((r) => r.day === today);
  if (mine) { mine.calls += pending.calls; mine.failures += pending.failures; }
  else if (pending.calls) out.unshift({ day: today, calls: pending.calls, failures: pending.failures });
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

/** Key health, for diagnostics. Never returns key material — tail only. */
export function modelKeyStatus() {
  const now = Date.now();
  return googleKeys().map((k, i) => ({
    index: i + 1,
    tail: `…${k.slice(-4)}`,
    healthy: (cooldown.get(k) ?? 0) <= now,
    /** The one currently being spent. Keys are used up in order, not in parallel. */
    inUse: k === current,
    strikes: strikes.get(k) ?? 0,
    cooldownSeconds: Math.max(0, Math.round(((cooldown.get(k) ?? 0) - now) / 1000)),
  }));
}

/** Which model id each tier settled on, for diagnostics. */
export function modelIdStatus() {
  return (["smart", "fast"] as ModelTier[]).map((tier) => ({
    tier,
    using: chosen.get(tier) ?? `${idsFor(tier)[0]} (untried)`,
    candidates: MODEL_IDS[tier],
  }));
}
