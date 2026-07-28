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
export async function edgeSpeak(text: string, opts?: { rate?: string }): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = await tts.toStream(withPauses(text), {
      rate: opts?.rate ?? "-8%", // a touch slower than default
      pitch: "-2%",
      volume: "+0%",
    });
    // Node Readable → Web ReadableStream for the Response body.
    return Readable.toWeb(audioStream as Readable) as ReadableStream<Uint8Array>;
  } catch {
    return null;
  }
}
