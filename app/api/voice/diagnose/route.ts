import { NextResponse } from "next/server";
import { fishKeys, fishSpeak } from "@/infrastructure/tts/fish";
import { cartesiaKeys, cartesiaSpeak } from "@/infrastructure/tts/cartesia";
import { edgeSpeak } from "@/infrastructure/tts/edge";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { modelKeyStatus, modelIdStatus } from "@/infrastructure/llm";

export const runtime = "nodejs";
export const maxDuration = 25;

/** Every probe is bounded — the point of this route is to answer, not to hang
 *  the way the thing it is diagnosing does. */
function within<T>(p: Promise<T>, ms: number, label: string): Promise<T | string> {
  return Promise.race([
    p,
    new Promise<string>((resolve) => setTimeout(() => resolve(`timed out after ${ms}ms (${label})`), ms)),
  ]);
}

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
      gemini: { keys: modelKeyStatus().length, status: modelKeyStatus(), models: modelIdStatus() },
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
        `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb"}?output_format=mp3_44100_64`,
        {
          method: "POST",
          headers: { "xi-api-key": eleven[0], "content-type": "application/json" },
          body: JSON.stringify({ text: probe, model_id: "eleven_flash_v2_5" }),
          signal: AbortSignal.timeout(5_000),
        },
      )
        .then((r) => (r.ok ? "ok" : `HTTP ${r.status}${r.status === 401 ? " (out of quota)" : r.status === 404 ? " (voice not on this account)" : ""}`))
        .catch((e) => `error: ${String(e).slice(0, 80)}`)
    : "not configured";

  live.edge = process.env.SAGE_DISABLE_EDGE === "1"
    ? "disabled"
    : String(await within(
        edgeSpeak(probe)
          .then(firstBytes)
          .then((n) => (n > 0 ? `ok — ${n} bytes` : "no audio (websocket blocked?)"))
          .catch((e) => `error: ${String(e).slice(0, 80)}`),
        4_000, "edge"));

  {
    const ks = modelKeyStatus();
    const up = ks.filter((k) => k.healthy).length;
    live.gemini = ks.length === 0
      ? "not configured"
      : `${up}/${ks.length} keys available${up < ks.length ? ` (${ks.filter((k) => !k.healthy).map((k) => `${k.tail} cooling ${k.cooldownSeconds}s`).join(", ")})` : ""}`;
  }

  const working = Object.entries(live).filter(([, v]) => v.startsWith("ok"));
  results.live = live;
  results.verdict = working.length
    ? `${working[0][0]} will answer — if you still hear the robot, the browser cached an older page; hard-refresh.`
    : "Every provider failed. The browser's own speech engine is all that's left, which is the robot you're hearing.";

  return NextResponse.json({ ok: true, data: results });
}
