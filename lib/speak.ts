"use client";

/**
 * Low-latency neural speech. Streams MP3 from ElevenLabs (flash model) and
 * begins playback on the FIRST chunk via MediaSource, so there's virtually no
 * wait. Degrades to a fast full-blob play (still the flash model) where
 * MediaSource/audio-mpeg isn't supported, then to browser speech synthesis.
 * Returns the <audio> (or null) so the caller can stop it.
 */
export async function speakLowLatency(
  text: string,
  opts?: { fast?: boolean; onended?: () => void },
): Promise<HTMLAudioElement | null> {
  const clean = text.trim();
  if (!clean) return null;
  const fast = opts?.fast !== false;

  let res: Response;
  try {
    res = await fetch(`/api/voice/speak?stream=1${fast ? "&fast=1" : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: clean }),
    });
  } catch {
    return browserSpeak(clean, opts?.onended);
  }
  if (!res.ok || !res.body) return browserSpeak(clean, opts?.onended);

  const MS: typeof MediaSource | undefined =
    (typeof window !== "undefined" && (window.MediaSource || (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource)) || undefined;

  // Progressive streaming path (lowest latency).
  if (MS && MS.isTypeSupported?.("audio/mpeg")) {
    try {
      const ms = new MS();
      const audio = new Audio();
      audio.src = URL.createObjectURL(ms);
      if (opts?.onended) audio.onended = opts.onended;

      await new Promise<void>((resolve) => ms.addEventListener("sourceopen", () => resolve(), { once: true }));
      const sb = ms.addSourceBuffer("audio/mpeg");
      const reader = res.body.getReader();
      let started = false;

      const append = (buf: ArrayBuffer) =>
        new Promise<void>((resolve) => {
          sb.addEventListener("updateend", () => resolve(), { once: true });
          sb.appendBuffer(buf);
        });

      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              const ab = new ArrayBuffer(value.byteLength);
              new Uint8Array(ab).set(value);
              await append(ab);
              if (!started) { started = true; audio.play().catch(() => {}); }
            }
          }
          if (ms.readyState === "open") ms.endOfStream();
        } catch {
          try { if (ms.readyState === "open") ms.endOfStream(); } catch { /* noop */ }
        }
      })();

      return audio;
    } catch {
      /* fall through to blob */
    }
  }

  // Fast blob fallback (flash model keeps this quick).
  try {
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); opts?.onended?.(); };
    await audio.play();
    return audio;
  } catch {
    return browserSpeak(clean, opts?.onended);
  }
}

function browserSpeak(text: string, onended?: () => void): null {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  if (!synth) return null;
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>[\]()]/g, ""));
  const v = synth.getVoices().find((x) => /en-GB/i.test(x.lang) && /male|daniel|george|arthur/i.test(x.name)) ?? null;
  if (v) u.voice = v;
  u.rate = 0.98;
  u.pitch = 0.85;
  if (onended) u.onend = onended;
  synth.speak(u);
  return null;
}
