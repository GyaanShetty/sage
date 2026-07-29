"use client";

/**
 * Low-latency neural speech. Streams MP3 from ElevenLabs (flash model) and
 * begins playback on the FIRST chunk via MediaSource, so there's virtually no
 * wait. Degrades to a fast full-blob play (still the flash model) where
 * MediaSource/audio-mpeg isn't supported, then to browser speech synthesis.
 * Returns the <audio> (or null) so the caller can stop it.
 */
/**
 * Browsers grant audio permission to an *element* that was played during a
 * user gesture, and only then. Every SAGE voice call happens after an `await`
 * (the fetch), which is far too late — the gesture has expired by the time we
 * have a stream, so `play()` rejects and the page just sits there in silence.
 *
 * So: one shared element, primed with a moment of silence on the very first
 * interaction anywhere in the app. From then on it is permanently allowed, and
 * all speech routes through it.
 */
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

let primed: HTMLAudioElement | null = null;

function sharedAudio(): HTMLAudioElement {
  if (!primed) primed = new Audio();
  return primed;
}

if (typeof window !== "undefined") {
  const prime = () => {
    const a = sharedAudio();
    // A 0.05s silent WAV — enough for the browser to register a played element.
    if (!a.src) a.src = SILENCE;
    a.muted = true;
    a.play().then(() => { a.pause(); a.muted = false; a.dataset.unlocked = "1"; })
      .catch(() => { a.muted = false; });
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(ev, prime, { once: true, capture: true });
  }
}

/** Surface a failure instead of failing silently — silence is the one outcome
 *  that is impossible to debug from the outside. */
function announce(title: string, body: string) {
  console.warn(`[voice] ${title}: ${body}`);
  window.dispatchEvent(new CustomEvent("sage:toast", { detail: { title, body } }));
}

export async function speakLowLatency(
  text: string,
  opts?: {
    fast?: boolean;
    onended?: () => void;
    /** Reuse a caller's gesture-unlocked <audio>. Mobile autoplay policy binds
     *  permission to the element that a user gesture touched, so a fresh
     *  Audio() here would be silently blocked on iOS. */
    audio?: HTMLAudioElement;
  },
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
  if (!res.ok || !res.body) {
    // A 503 with silent:true means the server deliberately refused rather than
    // failed — every neural provider is unconfigured or out of credit. Speaking
    // it in the browser's robot voice would bury that, so surface it instead.
    if (res.status === 503) {
      try {
        const j = await res.clone().json();
        if (j?.silent) {
          window.dispatchEvent(new CustomEvent("sage:toast", {
            detail: { title: "VOICE UNAVAILABLE", body: j.error ?? "No neural voice configured." },
          }));
          opts?.onended?.();
          return null;
        }
      } catch { /* not our JSON — fall through */ }
    }
    return browserSpeak(clean, opts?.onended);
  }

  const ctype = res.headers.get("content-type") || "";
  const provider = res.headers.get("x-sage-voice") || "unknown";
  const isMpeg = ctype.includes("mpeg") || ctype.includes("mp3");
  const MS: typeof MediaSource | undefined =
    (typeof window !== "undefined" && (window.MediaSource || (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource)) || undefined;

  /**
   * Start playback and, crucially, react when the browser refuses. The old
   * code swallowed that rejection, which turned a permissions problem into
   * pure silence with a 200 in the network tab and nothing in the console.
   */
  const start = (audio: HTMLAudioElement) =>
    audio.play().then(
      () => true,
      (err: DOMException) => {
        if (err?.name === "NotAllowedError") {
          announce("TAP TO ENABLE VOICE", "Your browser blocked autoplay. Tap anywhere and SAGE will speak.");
          const resume = () => { audio.play().catch(() => {}); };
          window.addEventListener("pointerdown", resume, { once: true });
        } else {
          announce("VOICE PLAYBACK FAILED", `${provider}: ${err?.name ?? "unknown error"}`);
        }
        return false;
      },
    );

  // Progressive streaming path (lowest latency) — MP3 only. When ElevenLabs is
  // out of credits the server returns Gemini WAV, which must go through the blob
  // path below (a WAV stream can't be appended to an audio/mpeg buffer).
  if (isMpeg && MS && MS.isTypeSupported?.("audio/mpeg")) {
    try {
      const ms = new MS();
      const audio = opts?.audio ?? sharedAudio();
      audio.src = URL.createObjectURL(ms);
      audio.muted = false;
      audio.volume = 1;
      audio.onended = opts?.onended ?? null;
      audio.onerror = null;

      await new Promise<void>((resolve) => ms.addEventListener("sourceopen", () => resolve(), { once: true }));
      const sb = ms.addSourceBuffer("audio/mpeg");
      const reader = res.body.getReader();
      let started = false;
      let bytes = 0;

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
              bytes += value.byteLength;
              const ab = new ArrayBuffer(value.byteLength);
              new Uint8Array(ab).set(value);
              await append(ab);
              if (!started) { started = true; void start(audio); }
            }
          }
          if (ms.readyState === "open") ms.endOfStream();
          // A 200 that carried no audio is a provider problem, not a player one.
          if (bytes === 0) {
            announce("VOICE EMPTY", `${provider} returned no audio. Check /api/voice/diagnose.`);
            opts?.onended?.();
          }
        } catch (e) {
          announce("VOICE STREAM FAILED", `${provider}: ${String(e).slice(0, 90)}`);
          try { if (ms.readyState === "open") ms.endOfStream(); } catch { /* noop */ }
          opts?.onended?.();
        }
      })();

      // Watchdog: if nothing is actually audible a few seconds in, say so
      // rather than leaving the caller stuck in a "speaking" state forever.
      window.setTimeout(() => {
        if (audio.paused && audio.currentTime === 0) {
          void start(audio);
        }
      }, 2_500);

      return audio;
    } catch (e) {
      console.warn("[voice] MediaSource path unavailable, using blob", e);
      /* fall through to blob */
    }
  }

  // Fast blob fallback (flash model keeps this quick).
  try {
    const blob = await res.blob();
    if (blob.size === 0) {
      announce("VOICE EMPTY", `${provider} returned no audio. Check /api/voice/diagnose.`);
      opts?.onended?.();
      return null;
    }
    const url = URL.createObjectURL(blob);
    const audio = opts?.audio ?? sharedAudio();
    audio.src = url;
    audio.muted = false;
    audio.volume = 1;
    audio.onended = () => { URL.revokeObjectURL(url); opts?.onended?.(); };
    await start(audio);
    return audio;
  } catch (e) {
    announce("VOICE PLAYBACK FAILED", String(e).slice(0, 90));
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
