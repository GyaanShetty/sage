import { proxyFetch } from "@/infrastructure/http/fetch";
import { edgeSpeak } from "@/infrastructure/tts/edge";
import { fishSpeak, fishKeys } from "@/infrastructure/tts/fish";
import { cartesiaSpeak, cartesiaKeys } from "@/infrastructure/tts/cartesia";
import { VOICE_DIRECTION } from "@/lib/config";

export const runtime = "nodejs";
// Deliberately short. A voice request that takes longer than this is useless
// anyway, and a long ceiling let a stalled provider burn the whole invocation
// and return a 504 instead of falling through to one that works.
export const maxDuration = 20;

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
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return new Response("Empty", { status: 400 });
  const clean = text.slice(0, 1400);

  // Name the rung that answered on the response itself. Silence with a 200 is
  // otherwise indistinguishable from silence with no request at all, and this
  // shows up in both the browser's network tab and the runtime logs.
  const mp3 = (b: BodyInit, provider: string) => {
    console.log(`[tts] ${provider} answered (${clean.length} chars, fast=${fast})`);
    return new Response(b, {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "no-store",
        "x-sage-voice": provider,
      },
    });
  };

  /** Fish Audio — msgpack API, free-tier model by default. */
  const tryFish = async (): Promise<Response | null> => {
    if (!fishKeys().length) return null;
    const s = await fishSpeak(clean, { fast });
    return s ? mp3(s, "fish") : null;
  };

  /** Cartesia Sonic — lowest latency of the neural providers. */
  const tryCartesia = async (): Promise<Response | null> => {
    if (!cartesiaKeys().length) return null;
    const s = await cartesiaSpeak(clean, { fast });
    return s ? mp3(s, "cartesia") : null;
  };

  /** ElevenLabs — rotate across keys, skipping ones that are out of credit. */
  const tryEleven = async (): Promise<Response | null> => {
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
          text: clean,
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

      if (res.ok) {
        // Always hand back the stream — buffering the whole MP3 first was
        // adding seconds of dead air before the first syllable.
        if (res.body) return mp3(res.body, "elevenlabs");
        return mp3(await res.arrayBuffer(), "elevenlabs");
      }
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
  const chains: Record<string, (() => Promise<Response | null>)[]> = {
    cartesia: [tryCartesia, tryFish, tryEleven],
    fish: [tryFish, tryCartesia, tryEleven],
    eleven: [tryEleven, tryFish, tryCartesia],
  };
  const order = chains[process.env.SAGE_TTS_PRIMARY ?? "eleven"] ?? chains.eleven;
  for (const attempt of order) {
    const out = await within(attempt(), PROVIDER_TIMEOUT_MS + 1_000);
    if (out) return out;
  }

  // ── Microsoft Edge neural TTS (free, streaming MP3) — fallback ──
  // Still a real neural voice (en-GB-RyanNeural), so it stays in the chain.
  if (process.env.SAGE_DISABLE_EDGE !== "1") {
    const edge = await within(edgeSpeak(clean), 3_000);
    if (edge) {
      return mp3(edge, "edge");
    }
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
