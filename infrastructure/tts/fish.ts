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

/** Every configured key, across FISH_AUDIO_API_KEY and FISH_AUDIO_API_KEYS. */
export function fishKeys(): string[] {
  const raw = `${process.env.FISH_AUDIO_API_KEY ?? ""},${process.env.FISH_AUDIO_API_KEYS ?? ""}`;
  return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

/** Per-key cooldown once a key reports no credit or rate-limiting. */
const keyCooldown = new Map<string, number>();

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
  if (!keys.length) return null;

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

  for (const key of keys) {
    if ((keyCooldown.get(key) ?? 0) > now) continue; // spent — try the next
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
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok && res.body) return res.body as ReadableStream<Uint8Array>;
      if (res.status === 401 || res.status === 402 || res.status === 429) {
        // out of credit or throttled — rest this key rather than hammering it
        keyCooldown.set(key, Date.now() + 6 * 3600_000);
      }
    } catch {
      // network/timeout — fall through to the next key
    }
  }
  return null;
}
