import { proxyFetch } from "@/infrastructure/http/fetch";
import { edgeSpeak } from "@/infrastructure/tts/edge";
import { fishSpeak, fishKeys } from "@/infrastructure/tts/fish";
import { cartesiaSpeak, cartesiaKeys } from "@/infrastructure/tts/cartesia";
import { VOICE_DIRECTION } from "@/lib/config";
import { splitForSpeech } from "@/lib/speech-split";

export const runtime = "nodejs";
// Deliberately short. A voice request that takes longer than this is useless
// anyway, and a long ceiling let a stalled provider burn the whole invocation
// and return a 504 instead of falling through to one that works.
// Long answers are spoken as several provider calls streamed back to back, so
// the invocation must outlive one call. Each individual provider is still
// bounded by PROVIDER_TIMEOUT_MS, which is what actually prevents a hang.
export const maxDuration = 60;

/** Per-provider deadline. Short on purpose: the chain has four more rungs
 *  below any given provider, so waiting long on a dead one is the worst
 *  possible trade. */
const PROVIDER_TIMEOUT_MS = 4_000;

/** Belt and braces: no single rung may exceed its own budget, whatever it
 *  does internally. Anything that misses simply yields to the next. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// Custom/cloned voice ids are scoped to the account that owns them, so the
// previous default 404'd the moment a second key from another account was
// added. George is a premade British male available on every account, which
// makes the default work with any key.
const ELEVEN_FALLBACK_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George — warm British male
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID ?? ELEVEN_FALLBACK_VOICE;
// Default to the fast flash model everywhere for low latency; the flash voices
// are still natural. Override with ELEVENLABS_MODEL.
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5";
// Gemini deep male voices: Charon (informative), Gacrux (mature),
// Algenib (gravelly), Iapetus (clear). Default to the mature, calm one.
const GEMINI_VOICE = process.env.SAGE_TTS_VOICE ?? "Charon";

/** All configured ElevenLabs keys — one per line/comma across ELEVENLABS_API_KEY
 *  and ELEVENLABS_API_KEYS. Add several free-tier keys and SAGE rotates through
 *  them so you effectively never run out. */
function elevenKeys(): string[] {
  const raw = `${process.env.ELEVENLABS_API_KEY ?? ""},${process.env.ELEVENLABS_API_KEYS ?? ""}`;
  return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}
// Per-key cooldown when a key reports out-of-credits / rate-limit.
const keyCooldown = new Map<string, number>();

/**
 * Neural TTS. Prefers ElevenLabs (richer, truly British) when
 * ELEVENLABS_API_KEY is set; otherwise Gemini's free tier with a deep male
 * voice + British delivery direction. Client falls back to browser speech.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const fast = url.searchParams.get("fast") === "1";   // low-latency flash model
  const { text, from } = (await req.json()) as { text?: string; from?: number };
  if (!text?.trim()) return new Response("Empty", { status: 400 });
  // Providers cap how much text they will take per request. Truncating to fit
  // is what made SAGE stop mid-sentence on any long answer; instead the text is
  // split on sentence boundaries and the pieces are spoken in order.
  const clean = text.slice(0, 12_000);
  const all = splitForSpeech(clean, 1200);

  /**
   * Where this response starts.
   *
   * A very long answer cannot be produced inside one invocation: this function
   * is capped at 60 seconds, and generating a dozen pieces sequentially can
   * outrun that. So a response covers as many pieces as it can within its
   * budget and reports where it stopped in `x-sage-next`; the client asks for
   * the rest and appends it to the same audio stream. The split is
   * deterministic, so both sides index the same pieces.
   */
  const start = Math.max(0, Math.min(Math.max(0, all.length - 1), Math.floor(Number(from) || 0)));

  /**
   * A fixed number of pieces per response, not a time estimate.
   *
   * The continuation header has to be written before the body streams, so
   * anything measured while streaming is too late to report accurately. Six
   * pieces is roughly seven thousand characters — comfortably inside the
   * 60-second ceiling at two to four seconds a piece — and it makes the header
   * exact rather than a guess the client has to second-guess.
   */
  const MAX_PIECES = 6;
  const chunks = all.slice(start, start + MAX_PIECES);
  const nextIndex = start + chunks.length < all.length ? start + chunks.length : null;

  // Name the rung that answered on the response itself. Silence with a 200 is
  // otherwise indistinguishable from silence with no request at all, and this
  // shows up in both the browser's network tab and the runtime logs.
  const mp3 = (b: BodyInit, provider: string, next: number | null = null) => {
    console.log(`[tts] ${provider} answered (${clean.length} chars, fast=${fast})`);
    return new Response(b, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "no-store",
        "x-sage-voice": provider,
        // How far this response got, so the client can continue where it
        // stopped rather than losing the tail of a long answer.
        "x-sage-total": String(all.length),
        "x-sage-from": String(start),
        ...(next !== null ? { "x-sage-next": String(next) } : {}),
      },
    });
  };

  /** Fish Audio — msgpack API, free-tier model by default. */
  const tryFish = async (piece: string): Promise<ReadableStream<Uint8Array> | null> =>
    fishKeys().length ? fishSpeak(piece, { fast }) : null;

  /** Cartesia Sonic — lowest latency of the neural providers. */
  const tryCartesia = async (piece: string): Promise<ReadableStream<Uint8Array> | null> =>
    cartesiaKeys().length ? cartesiaSpeak(piece, { fast }) : null;

  /** ElevenLabs — rotate across keys, skipping ones that are out of credit. */
  const tryEleven = async (piece: string): Promise<ReadableStream<Uint8Array> | null> => {
  const model = fast ? (process.env.ELEVENLABS_FAST_MODEL ?? ELEVEN_MODEL) : ELEVEN_MODEL;
  const fmt = fast ? "mp3_44100_64" : "mp3_44100_128";
  // Always the streaming endpoint with max latency optimisation — the
  // non-streaming one only ever added dead air.
  const now = Date.now();

  const call = (key: string, voice: string) =>
    proxyFetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=${fmt}&optimize_streaming_latency=4`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          text: piece,
          model_id: model,
          voice_settings: { stability: 0.3, similarity_boost: 0.85, style: 0.55, use_speaker_boost: true },
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      },
    );

  for (const key of elevenKeys()) {
    if ((keyCooldown.get(key) ?? 0) > now) continue; // this key is out of credits — skip
    try {
      let res = await call(key, ELEVEN_VOICE);

      // 404 means this key's account doesn't own that voice — a cloned voice
      // from another account. Retry once on the premade voice rather than
      // discarding a perfectly good key.
      if (res.status === 404 && ELEVEN_VOICE !== ELEVEN_FALLBACK_VOICE) {
        res = await call(key, ELEVEN_FALLBACK_VOICE);
      }

      if (res.ok && res.body) return res.body as ReadableStream<Uint8Array>;
      // Out of credits / rate-limited → cool this key down; try the next one.
      if (res.status === 401 || res.status === 402 || res.status === 429) {
        keyCooldown.set(key, Date.now() + 6 * 3600_000); // 6h; credits reset monthly but this avoids hammering
      }
    } catch {
      // network — try next key
    }
  }
    return null;
  };

  // Which neural provider leads. SAGE_TTS_PRIMARY picks the head of the chain;
  // the others still follow it, so one provider running dry is never fatal.
  const chains: Record<string, ((piece: string) => Promise<ReadableStream<Uint8Array> | null>)[]> = {
    cartesia: [tryCartesia, tryFish, tryEleven],
    fish: [tryFish, tryCartesia, tryEleven],
    eleven: [tryEleven, tryFish, tryCartesia],
  };
  const order = chains[process.env.SAGE_TTS_PRIMARY ?? "eleven"] ?? chains.eleven;

  /** First provider that produces audio for one piece of text. */
  const speakPiece = async (piece: string): Promise<ReadableStream<Uint8Array> | null> => {
    for (const attempt of order) {
      const out = await within(attempt(piece), PROVIDER_TIMEOUT_MS + 1_000);
      if (out) return out;
    }
    if (process.env.SAGE_DISABLE_EDGE !== "1") {
      const edge = await within(edgeSpeak(piece), 3_000);
      if (edge) return edge;
    }
    return null;
  };

  // The first piece decides whether we can speak at all; failing fast here
  // means the refusal below still reaches the user instead of a half-second of
  // audio followed by silence.
  const firstStream = await speakPiece(chunks[0]);
  if (firstStream) {
    if (chunks.length === 1) return mp3(firstStream, "neural", nextIndex);

    /**
     * Long answers: stream each piece in turn into one continuous response.
     * MP3 frames concatenate cleanly, so the client hears a single unbroken
     * take rather than several requests it would have to sequence itself.
     * A piece that fails mid-way ends the stream rather than skipping ahead —
     * silently omitting a paragraph is worse than stopping.
     */
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const pump = async (rs: ReadableStream<Uint8Array>) => {
          const reader = rs.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        };
        try {
          await pump(firstStream);
          for (const piece of chunks.slice(1)) {
            const next = await speakPiece(piece);
            if (!next) break;
            await pump(next);
          }
        } catch {
          // Client went away, or a provider dropped — close cleanly either way.
        } finally {
          controller.close();
        }
      },
    });

    return mp3(stream, `neural×${chunks.length}`, nextIndex);
  }

  /**
   * Below this line the voice stops sounding like SAGE. Gemini's TTS and the
   * browser's own engine are the "robot" — reaching them means the real
   * providers are misconfigured, and quietly speaking in that voice hides the
   * problem instead of surfacing it. So by default we refuse and say why.
   * Set SAGE_TTS_ALLOW_ROBOT=1 to restore the old degrade-to-anything path.
   */
  const configured = cartesiaKeys().length + fishKeys().length + elevenKeys().length;
  if (process.env.SAGE_TTS_ALLOW_ROBOT !== "1") {
    return Response.json(
      {
        ok: false,
        error: configured === 0
          ? "No neural voice is configured. Set CARTESIA_API_KEYS, FISH_AUDIO_API_KEYS or ELEVENLABS_API_KEYS."
          : "Every configured neural voice failed — most likely out of credit or a bad key.",
        providersConfigured: configured,
        diagnose: "/api/voice/diagnose",
        silent: true,
      },
      { status: 503 },
    );
  }

  // ── Gemini free tier (deep British male) ──────────────────
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) return new Response("TTS not configured", { status: 400 });

  const res = await proxyFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${VOICE_DIRECTION} ${clean}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } },
        },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    },
  );

  if (!res.ok) return new Response(`TTS failed: ${res.status}`, { status: 502 });
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const b64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) return new Response("No audio", { status: 502 });

  // Gemini returns raw 16-bit PCM @ 24kHz mono — wrap in a WAV header.
  const pcm = Buffer.from(b64, "base64");
  const header = Buffer.alloc(44);
  const sampleRate = 24000;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return new Response(new Uint8Array(Buffer.concat([header, pcm])), {
    headers: { "content-type": "audio/wav", "cache-control": "no-store" },
  });
}
