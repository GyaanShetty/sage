import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { Readable } from "node:stream";

// Microsoft Edge neural voices — free, no key, high quality. Deep British males:
// en-GB-RyanNeural, en-GB-ThomasNeural. Override with SAGE_EDGE_VOICE.
const VOICE = process.env.SAGE_EDGE_VOICE ?? "en-GB-RyanNeural";

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build input with a natural paragraph pause; sentences are left to the neural
 *  model's own prosody (it handles "U.S." etc. correctly — no manual splitting). */
function withPauses(text: string): string {
  return text
    .split(/\n{2,}|\n/)
    .map((p) => escape(p.trim()))
    .filter(Boolean)
    .join(' <break time="420ms"/> ');
}

/**
 * Synthesize speech with Microsoft's neural TTS as a streaming MP3. A real
 * neural voice (not the OS's robotic one), free and effectively unlimited, with
 * SSML control over pace so SAGE speaks slowly and deliberately like a person.
 * Returns a Web ReadableStream (or null on failure) so the route can stream it.
 */
/** Hard ceiling for the handshake. msedge-tts opens a WebSocket to Microsoft
 *  and offers no timeout of its own: when that socket stalls — which it does
 *  from some hosts — the caller hangs until the platform kills the whole
 *  function. That surfaced as a 504 on Vercel and as a very long silence
 *  before the browser's own robotic voice took over. */
const HANDSHAKE_MS = 2_500;

function deadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`edge ${what} timed out`)), ms)),
  ]);
}

export async function edgeSpeak(text: string, opts?: { rate?: string }): Promise<ReadableStream<Uint8Array> | null> {
  let tts: MsEdgeTTS | null = null;
  try {
    tts = new MsEdgeTTS();
    await deadline(tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3), HANDSHAKE_MS, "handshake");
    const { audioStream } = await deadline(Promise.resolve(tts.toStream(withPauses(text), {
      rate: opts?.rate ?? "-8%", // a touch slower than default
      pitch: "-2%",
      volume: "+0%",
    })), HANDSHAKE_MS, "stream");
    // Node Readable → Web ReadableStream for the Response body.
    return Readable.toWeb(audioStream as Readable) as ReadableStream<Uint8Array>;
  } catch {
    // Drop the socket rather than leaving it dangling for the rest of the
    // function's life.
    try { (tts as unknown as { close?: () => void })?.close?.(); } catch { /* noop */ }
    return null;
  }
}
