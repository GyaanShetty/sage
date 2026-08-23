import { encode } from "@msgpack/msgpack";
import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Fish Audio TTS (api.fish.audio).
 *
 * Their API takes a msgpack body, not JSON — matching the official SDK, which
 * posts `application/msgpack` with a `model` header. Auth is checked before the
 * body is parsed, so a wrong content type fails late and confusingly; sending
 * msgpack keeps us on the path the vendor actually tests.
 *
 * Free tier is ~8k credits/month (roughly 13 minutes) and is personal-use only.
 * Multiple keys can be supplied and are rotated, the same way ElevenLabs keys
 * are, so a spent key doesn't take the voice down.
 */

const ENDPOINT = "https://api.fish.audio/v1/tts";

/** s2.1-pro-free is their free-tier model; s2-pro is the paid flagship. */
const MODEL = process.env.FISH_AUDIO_MODEL ?? "s2.1-pro-free";
/** Voice model id from a fish.audio voice URL. Unset → their default voice. */
const VOICE_ID = process.env.FISH_AUDIO_VOICE_ID ?? "";

/** Long enough that a slow-but-working synthesis is not mistaken for a dead
 *  provider. The route still caps the whole rung above this. */
const TIMEOUT_MS = Number(process.env.FISH_TIMEOUT_MS ?? 9_000);

/** Keys must never reach a log or a response intact. */
const mask = (k: string) => (k.length <= 6 ? "***" : `…${k.slice(-4)}`);

/** Every configured key, across FISH_AUDIO_API_KEY and FISH_AUDIO_API_KEYS. */
export function fishKeys(): string[] {
  const raw = `${process.env.FISH_AUDIO_API_KEY ?? ""},${process.env.FISH_AUDIO_API_KEYS ?? ""}`;
  return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

/** Per-key cooldown once a key reports no credit or rate-limiting. */
const keyCooldown = new Map<string, number>();

/**
 * Why the last attempt produced no audio.
 *
 * fishSpeak returns null for every failure — no key, bad key, no credit,
 * throttled, timed out, host unreachable — and null carries none of that. The
 * caller then falls through to the next provider and the reason is gone, which
 * is how "the voice has stopped working" became unanswerable: even
 * /api/voice/diagnose could only report "no audio", because fishSpeak never
 * throws and there was nothing for its .catch() to catch.
 *
 * Same failure as the LeetCode search: a function that conflates "it did not
 * work" with "there is nothing here". Recording the reason costs nothing and
 * turns an afternoon of guessing into one glance.
 */
let lastError: string | null = null;

/** The reason the last fishSpeak call produced no audio, if it did not. */
export function lastFishError(): string | null {
  return lastError;
}

export interface FishOpts {
  /** Lower latency at some cost to quality. */
  fast?: boolean;
  /** 0.5–2.0; below 1 is slower. */
  speed?: number;
}

/**
 * Synthesize speech as a streaming MP3. Returns null when no key is configured
 * or every key is exhausted, so the caller can fall through to another provider.
 */
export async function fishSpeak(text: string, opts: FishOpts = {}): Promise<ReadableStream<Uint8Array> | null> {
  const keys = fishKeys();
  if (!keys.length) {
    lastError = "no FISH_AUDIO_API_KEY / FISH_AUDIO_API_KEYS configured";
    return null;
  }

  const payload: Record<string, unknown> = {
    text,
    format: "mp3",
    mp3_bitrate: opts.fast ? 64 : 128,
    // 100–300; smaller chunks start playing sooner
    chunk_length: opts.fast ? 120 : 200,
    latency: opts.fast ? "balanced" : "normal",
    normalize: true,
    prosody: { speed: opts.speed ?? 0.94, volume: 0 },
  };
  if (VOICE_ID) payload.reference_id = VOICE_ID;

  const body = encode(payload);
  const now = Date.now();
  const reasons: string[] = [];
  let cooling = 0;

  for (const key of keys) {
    if ((keyCooldown.get(key) ?? 0) > now) { cooling += 1; continue; } // spent — try the next
    try {
      const res = await proxyFetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/msgpack",
          model: MODEL,
        },
        // copy into a plain ArrayBuffer — encode() returns a view over a pool
        body: body.slice().buffer as ArrayBuffer,
        // Synthesis on the free model is not always quick, and this used to be
        // four seconds — short enough that a healthy key with credit still
        // timed out, silently, and looked exactly like a dead one.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok && res.body) {
        lastError = null;
        return res.body as ReadableStream<Uint8Array>;
      }

      // The body carries fish's own explanation ("Invalid Token", "insufficient
      // credit"); it is far more useful than the bare status.
      const detail = await res.text().then((t) => t.slice(0, 120)).catch(() => "");
      reasons.push(`${mask(key)}: HTTP ${res.status}${detail ? ` ${detail}` : ""}`);

      if (res.status === 401 || res.status === 402 || res.status === 429) {
        // A bad key and a spent key are not the same thing. 429 is a throttle
        // that clears in seconds; resting it for six hours threw away a
        // perfectly good key for the rest of the day.
        const restMs = res.status === 429 ? 60_000 : 6 * 3600_000;
        keyCooldown.set(key, Date.now() + restMs);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reasons.push(`${mask(key)}: ${/abort|timeout/i.test(msg) ? `no response in ${TIMEOUT_MS}ms` : msg.slice(0, 120)}`);
    }
  }

  lastError = reasons.length
    ? reasons.join("; ")
    : `all ${cooling} key(s) cooling down from an earlier failure`;
  return null;
}
