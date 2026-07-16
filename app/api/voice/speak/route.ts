import { proxyFetch } from "@/infrastructure/http/fetch";

export const maxDuration = 60;

/**
 * Neural TTS via Gemini (free tier). Returns WAV audio.
 * The client falls back to browser speechSynthesis if this fails.
 */
export async function POST(req: Request) {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) return new Response("TTS not configured", { status: 400 });

  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return new Response("Empty", { status: 400 });

  const res = await proxyFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Speak as a composed, refined English butler — calm, measured, quietly warm, unhurried: ${text.slice(0, 1200)}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Iapetus" } },
          },
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
