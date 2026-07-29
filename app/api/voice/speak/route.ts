import { proxyFetch } from "@/infrastructure/http/fetch";
import { edgeSpeak } from "@/infrastructure/tts/edge";
import { VOICE_DIRECTION } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

// ElevenLabs default British male voices: "Daniel" (deep news presenter),
// "George" (warm, mature). Overridable via env. Free tier: ~10k chars/mo.
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID ?? "ZbAwehCkhEdz5R21COAP"; // Gyaan's chosen SAGE voice
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
  const stream = url.searchParams.get("stream") === "1"; // pass audio through as it generates
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return new Response("Empty", { status: 400 });
  const clean = text.slice(0, 1400);

  // ── ElevenLabs (primary) — rotate across keys, skip exhausted ones ──
  const model = fast ? (process.env.ELEVENLABS_FAST_MODEL ?? ELEVEN_MODEL) : ELEVEN_MODEL;
  const fmt = fast ? "mp3_44100_64" : "mp3_44100_128";
  const path = stream
    ? `${ELEVEN_VOICE}/stream?output_format=${fmt}&optimize_streaming_latency=4`
    : `${ELEVEN_VOICE}?output_format=${fmt}`;
  const now = Date.now();
  for (const key of elevenKeys()) {
    if ((keyCooldown.get(key) ?? 0) > now) continue; // this key is out of credits — skip
    try {
      const res = await proxyFetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${path}`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            text: clean,
            model_id: model,
            voice_settings: { stability: 0.3, similarity_boost: 0.85, style: 0.55, use_speaker_boost: true },
          }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (res.ok) {
        if (stream && res.body) {
          return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
        }
        return new Response(await res.arrayBuffer(), { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
      }
      // Out of credits / rate-limited → cool this key down; try the next one.
      if (res.status === 401 || res.status === 402 || res.status === 429) {
        keyCooldown.set(key, Date.now() + 6 * 3600_000); // 6h; credits reset monthly but this avoids hammering
      }
    } catch {
      // network — try next key
    }
  }

  // ── Microsoft Edge neural TTS (free, streaming MP3) — fallback ──
  if (process.env.SAGE_DISABLE_EDGE !== "1") {
    const edge = await edgeSpeak(clean);
    if (edge) {
      return new Response(edge, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
    }
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
      signal: AbortSignal.timeout(45_000),
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
