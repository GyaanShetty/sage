import { NextResponse } from "next/server";
import { fishKeys, fishSpeak } from "@/infrastructure/tts/fish";
import { cartesiaKeys, cartesiaSpeak } from "@/infrastructure/tts/cartesia";
import { edgeSpeak } from "@/infrastructure/tts/edge";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Why is the robot voice speaking?
 *
 * The client only falls back to the browser's Web Speech engine when
 * /api/voice/speak fails outright, which means every provider below it failed
 * too. This reports what is configured and what actually answers, so the
 * failing link is obvious without digging through logs. Never returns key
 * material — only counts and a masked tail.
 */

const mask = (k: string) => (k.length <= 6 ? "***" : `…${k.slice(-4)}`);

/** Drain just enough of a stream to prove real audio is coming back. */
async function firstBytes(s: ReadableStream<Uint8Array> | null): Promise<number> {
  if (!s) return 0;
  const reader = s.getReader();
  try {
    const { value } = await reader.read();
    return value?.byteLength ?? 0;
  } finally {
    reader.cancel().catch(() => {});
  }
}

export async function GET() {
  const probe = "Systems nominal.";
  const eleven = (() => {
    const raw = `${process.env.ELEVENLABS_API_KEY ?? ""},${process.env.ELEVENLABS_API_KEYS ?? ""}`;
    return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
  })();

  const results: Record<string, unknown> = {
    primary: process.env.SAGE_TTS_PRIMARY ?? "eleven (default)",
    configured: {
      cartesia: { keys: cartesiaKeys().length, sample: cartesiaKeys().map(mask) },
      fish: { keys: fishKeys().length, sample: fishKeys().map(mask) },
      elevenlabs: { keys: eleven.length, sample: eleven.map(mask) },
      gemini: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      edgeDisabled: process.env.SAGE_DISABLE_EDGE === "1",
    },
    voices: {
      cartesia: process.env.CARTESIA_VOICE_ID ?? "(default Alistair)",
      fish: process.env.FISH_AUDIO_VOICE_ID ?? "(fish default)",
      elevenlabs: process.env.ELEVENLABS_VOICE_ID ?? "(built-in default)",
    },
  };

  const live: Record<string, string> = {};

  live.cartesia = cartesiaKeys().length
    ? await cartesiaSpeak(probe, { fast: true })
        .then(firstBytes)
        .then((n) => (n > 0 ? `ok — ${n} bytes` : "no audio"))
        .catch((e) => `error: ${String(e).slice(0, 80)}`)
    : "not configured";

  live.fish = fishKeys().length
    ? await fishSpeak(probe, { fast: true })
        .then(firstBytes)
        .then((n) => (n > 0 ? `ok — ${n} bytes` : "no audio"))
        .catch((e) => `error: ${String(e).slice(0, 80)}`)
    : "not configured";

  live.elevenlabs = eleven.length
    ? await proxyFetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID ?? "ZbAwehCkhEdz5R21COAP"}?output_format=mp3_44100_64`,
        {
          method: "POST",
          headers: { "xi-api-key": eleven[0], "content-type": "application/json" },
          body: JSON.stringify({ text: probe, model_id: "eleven_flash_v2_5" }),
          signal: AbortSignal.timeout(20_000),
        },
      )
        .then((r) => (r.ok ? "ok" : `HTTP ${r.status}${r.status === 401 ? " (bad key / out of quota)" : ""}`))
        .catch((e) => `error: ${String(e).slice(0, 80)}`)
    : "not configured";

  live.edge = process.env.SAGE_DISABLE_EDGE === "1"
    ? "disabled"
    : await edgeSpeak(probe)
        .then(firstBytes)
        .then((n) => (n > 0 ? `ok — ${n} bytes` : "no audio (websocket blocked?)"))
        .catch((e) => `error: ${String(e).slice(0, 80)}`);

  live.gemini = process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "key present" : "not configured";

  const working = Object.entries(live).filter(([, v]) => v.startsWith("ok"));
  results.live = live;
  results.verdict = working.length
    ? `${working[0][0]} will answer — if you still hear the robot, the browser cached an older page; hard-refresh.`
    : "Every provider failed. The browser's own speech engine is all that's left, which is the robot you're hearing.";

  return NextResponse.json({ ok: true, data: results });
}
