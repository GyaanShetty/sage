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

  // "device" mode → speak entirely on-device (instant, unlimited, 100% free).
  let mode = "cloud";
  try { mode = JSON.parse(localStorage.getItem("sage-shell") || "{}")?.state?.voiceMode ?? "cloud"; } catch { /* default */ }
  if (mode === "device") return browserSpeak(clean, opts?.onended);

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

  const ctype = res.headers.get("content-type") || "";
  const isMpeg = ctype.includes("mpeg") || ctype.includes("mp3");
  const MS: typeof MediaSource | undefined =
    (typeof window !== "undefined" && (window.MediaSource || (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource)) || undefined;

  // Progressive streaming path (lowest latency) — MP3 only. When ElevenLabs is
  // out of credits the server returns Gemini WAV, which must go through the blob
  // path below (a WAV stream can't be appended to an audio/mpeg buffer).
  if (isMpeg && MS && MS.isTypeSupported?.("audio/mpeg")) {
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

// Never pick these — clearly female system voices.
const FEMALE = /samantha|karen|moira|tessa|fiona|victoria|serena|kate|susan|zira|female|amelie|anna|ellen|joana|luciana|paulina|alice|amira/i;
const MALE = /male|daniel|george|arthur|oliver|arthur|thomas|rishi|gordon|guy|david|fred|alex|aaron|reed|rocko/i;

function pickMaleVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const vs = synth.getVoices();
  return (
    vs.find((v) => /en-GB/i.test(v.lang) && MALE.test(v.name)) ??
    vs.find((v) => v.name === "Google UK English Male") ??
    vs.find((v) => /^en/i.test(v.lang) && MALE.test(v.name)) ??
    vs.find((v) => /en-GB/i.test(v.lang) && !FEMALE.test(v.name)) ??
    vs.find((v) => /^en/i.test(v.lang) && !FEMALE.test(v.name)) ??
    null
  );
}

/** Browser speech, made human: a deep male voice, slow pace, and real pauses —
 *  each sentence is a separate utterance, with a longer beat between paragraphs. */
function browserSpeak(text: string, onended?: () => void): null {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  if (!synth) return null;
  synth.cancel();

  const clean = text.replace(/[*_#`>[\]()]/g, "");
  // Chunk by PARAGRAPH only — let the voice handle sentence pauses itself, so
  // abbreviations like "U.S." don't cause a hard stop mid-sentence.
  const chunks = clean.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);

  const speakOne = (i: number) => {
    if (i >= chunks.length) { onended?.(); return; }
    const u = new SpeechSynthesisUtterance(chunks[i]);
    const v = pickMaleVoice(synth);
    if (v) u.voice = v;
    u.rate = 0.95;  // natural, unhurried — not sluggish
    u.pitch = 0.82; // deep male
    u.onend = () => window.setTimeout(() => speakOne(i + 1), 300); // beat between paragraphs
    u.onerror = () => speakOne(i + 1);
    synth.speak(u);
  };

  // voices can load async
  if (synth.getVoices().length === 0) {
    synth.addEventListener("voiceschanged", () => speakOne(0), { once: true });
    window.setTimeout(() => speakOne(0), 250);
  } else {
    speakOne(0);
  }
  return null;
}
