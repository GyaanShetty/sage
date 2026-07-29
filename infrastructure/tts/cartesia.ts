import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Cartesia TTS (api.cartesia.ai) — Sonic.
 *
 * Plain JSON, unlike Fish Audio's msgpack. The API-version header is required
 * and pins the request/response shape, so it is set explicitly rather than
 * left to whatever the account defaults to.
 *
 * The lowest-latency of the providers here, and noticeably more compact on the
 * wire. Keys rotate the same way ElevenLabs and Fish keys do.
 */

const ENDPOINT = "https://api.cartesia.ai/tts/bytes";
const API_VERSION = process.env.CARTESIA_VERSION ?? "2024-11-13";

/** sonic-2 is the current flagship; sonic-turbo trades a little quality for speed. */
const MODEL = process.env.CARTESIA_MODEL ?? "sonic-2";

/** "Alistair — sophisticated, steady British male", closest to SAGE's persona. */
const VOICE_ID = process.env.CARTESIA_VOICE_ID ?? "c8f7835e-28a3-4f0c-80d7-c1302ac62aae";

export function cartesiaKeys(): string[] {
  const raw = `${process.env.CARTESIA_API_KEY ?? ""},${process.env.CARTESIA_API_KEYS ?? ""}`;
  return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

const keyCooldown = new Map<string, number>();

export interface CartesiaOpts {
  /** Lower bitrate + turbo model for faster first audio. */
  fast?: boolean;
  /** Cartesia takes named speeds rather than a multiplier. */
  speed?: "slowest" | "slow" | "normal" | "fast" | "fastest";
}

/**
 * Synthesize speech as a streaming MP3. Returns null when no key is configured
 * or every key is exhausted, so the caller can fall through to another provider.
 */
export async function cartesiaSpeak(text: string, opts: CartesiaOpts = {}): Promise<ReadableStream<Uint8Array> | null> {
  const keys = cartesiaKeys();
  if (!keys.length) return null;

  const body = JSON.stringify({
    model_id: opts.fast ? (process.env.CARTESIA_FAST_MODEL ?? "sonic-turbo") : MODEL,
    transcript: text,
    voice: {
      mode: "id",
      id: VOICE_ID,
      // slightly under natural pace — SAGE speaks deliberately
      __experimental_controls: { speed: opts.speed ?? "slow" },
    },
    output_format: {
      container: "mp3",
      sample_rate: 44100,
      bit_rate: opts.fast ? 64000 : 128000,
    },
    language: "en",
  });

  const now = Date.now();
  for (const key of keys) {
    if ((keyCooldown.get(key) ?? 0) > now) continue; // spent — try the next
    try {
      const res = await proxyFetch(ENDPOINT, {
        method: "POST",
        headers: {
          "X-API-Key": key,
          "Cartesia-Version": API_VERSION,
          "content-type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok && res.body) return res.body as ReadableStream<Uint8Array>;
      if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
        keyCooldown.set(key, Date.now() + 6 * 3600_000);
      }
    } catch {
      // network/timeout — fall through to the next key
    }
  }
  return null;
}
