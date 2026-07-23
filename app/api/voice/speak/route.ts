import { proxyFetch } from "@/infrastructure/http/fetch";
import { VOICE_DIRECTION } from "@/lib/config";

export const maxDuration = 60;

// ElevenLabs default British male voices: "Daniel" (deep news presenter),
// "George" (warm, mature). Overridable via env. Free tier: ~10k chars/mo.
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb"; // George — warm, mature British
// Gemini deep male voices: Charon (informative), Gacrux (mature),
// Algenib (gravelly), Iapetus (clear). Default to the mature, calm one.
const GEMINI_VOICE = process.env.SAGE_TTS_VOICE ?? "Charon";

/**
 * Neural TTS. Prefers ElevenLabs (richer, truly British) when
 * ELEVENLABS_API_KEY is set; otherwise Gemini's free tier with a deep male
 * voice + British delivery direction. Client falls back to browser speech.
 */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return new Response("Empty", { status: 400 });
  const clean = text.slice(0, 1400);

  // ── ElevenLabs (premium) ──────────────────────────────────
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (elevenKey) {
    try {
      const res = await proxyFetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": elevenKey, "content-type": "application/json" },
          body: JSON.stringify({
            text: clean,
            model_id: "eleven_turbo_v2_5",
            voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
          }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (res.ok) {
        return new Response(await res.arrayBuffer(), {
          headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
        });
      }
      // fall through to Gemini on failure
    } catch {
      // fall through
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
