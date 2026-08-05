"use client";

import { splitIntoParts, handoffLine } from "@/lib/speech-split";

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

/**
 * The rest of a long answer, waiting to be asked for.
 *
 * Module state rather than a store: it belongs to the audio element, which is
 * also a singleton, and threading it through the UI would spread one fact
 * across four components that do not otherwise care.
 */
let pending: { parts: string[]; index: number; opts?: SpeakOpts } | null = null;

export interface SpeakOpts {
  fast?: boolean;
  onended?: () => void;
  audio?: HTMLAudioElement;
}

/** Is there more of the last answer that SAGE has not said yet? */
export function hasMoreToSay(): boolean {
  return !!pending && pending.index < pending.parts.length - 1;
}

/** How many parts are still unsaid. */
export function partsRemaining(): number {
  return pending ? Math.max(0, pending.parts.length - 1 - pending.index) : 0;
}

/** Drop the rest — a new question makes the old answer's tail irrelevant. */
export function forgetRest(): void {
  pending = null;
  window.dispatchEvent(new CustomEvent("sage:voice-more", { detail: { remaining: 0 } }));
}

/**
 * Say the next part of the previous answer.
 *
 * Triggered by "go on", by the Continue control, or by anything else that
 * decides the user wants the rest.
 */
export async function speakRest(): Promise<HTMLAudioElement | null> {
  if (!pending || pending.index >= pending.parts.length - 1) return null;
  pending.index += 1;
  const { parts, index, opts } = pending;
  const more = index < parts.length - 1;
  const line = more ? `${parts[index]} ${handoffLine(index, parts.length)}` : parts[index];

  window.dispatchEvent(new CustomEvent("sage:voice-more", {
    detail: { remaining: parts.length - 1 - index },
  }));
  if (!more) pending = null;

  return speakOne(line, opts);
}

/**
 * Speak an answer, a minute at a time.
 *
 * Long answers are not spoken as one unbroken monologue. Five minutes of
 * uninterrupted speech is a poor way to be told anything, and it is also the
 * regime where every technical limit bites at once — the audio buffer, the
 * function timeout, the user's patience. SAGE says a part, tells you how much
 * is left, and waits to be asked.
 */
export async function speakLowLatency(
  text: string,
  opts?: SpeakOpts,
): Promise<HTMLAudioElement | null> {
  const whole = text.trim();
  if (!whole) return null;

  const parts = splitIntoParts(whole);
  // A new answer supersedes whatever was left of the last one.
  pending = parts.length > 1 ? { parts, index: 0, ...(opts ? { opts } : {}) } : null;

  window.dispatchEvent(new CustomEvent("sage:voice-more", {
    detail: { remaining: Math.max(0, parts.length - 1) },
  }));

  const first = parts.length > 1 ? `${parts[0]} ${handoffLine(0, parts.length)}` : parts[0];
  return speakOne(first, opts);
}

async function speakOne(
  text: string,
  /** Reuse a caller's gesture-unlocked <audio>. Mobile autoplay policy binds
   *  permission to the element that a user gesture touched, so a fresh
   *  Audio() here would be silently blocked on iOS. */
  opts?: {
    fast?: boolean;
    onended?: () => void;
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

  /**
   * One segment of the answer.
   *
   * The server caps how much it will speak per response, because the function
   * it runs in is capped at 60 seconds and a long answer cannot be generated
   * inside that. It reports where it stopped in `x-sage-next`, and this is how
   * the rest is fetched.
   */
  const segment = (from: number) =>
    fetch(`/api/voice/speak?stream=1${fast ? "&fast=1" : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: clean, from }),
    });

  let res: Response;
  try {
    res = await segment(0);
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
      // iOS exposes ManagedMediaSource rather than MediaSource, and refuses to
      // attach one unless remote playback is disabled first. Without this the
      // element simply never plays — silently, which is the worst kind.
      try { (audio as HTMLAudioElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true; } catch { /* not supported */ }
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

      const once = (buf: ArrayBuffer) =>
        new Promise<void>((resolve, reject) => {
          const ok = () => { cleanup(); resolve(); };
          const bad = () => { cleanup(); reject(new Error("append failed")); };
          const cleanup = () => {
            sb.removeEventListener("updateend", ok);
            sb.removeEventListener("error", bad);
          };
          sb.addEventListener("updateend", ok, { once: true });
          sb.addEventListener("error", bad, { once: true });
          try { sb.appendBuffer(buf); } catch (e) { cleanup(); reject(e); }
        });

      /**
       * Append, making room first if the buffer is full.
       *
       * A SourceBuffer holds a bounded amount of audio — a few minutes at
       * most, and far less on mobile. Past that, appendBuffer throws
       * QuotaExceededError, which ended the read loop and closed the stream:
       * SAGE stopped mid-sentence on any long answer, always at roughly the
       * same length, which is exactly what a fixed buffer looks like.
       *
       * The fix is to evict what has already been played. Audio behind the
       * playhead is never needed again, so dropping it costs nothing and
       * makes the ceiling irrelevant.
       */
      const evict = () =>
        new Promise<void>((resolve) => {
          // Keep a short tail behind the playhead, not ten seconds. On a phone
          // the buffer is small enough that quota can be reached before three
          // seconds have played, and a ten-second margin made eviction a no-op
          // exactly when it was needed.
          const keepFrom = Math.max(0, audio.currentTime - 2);
          if (keepFrom <= 0.1 || sb.updating) { resolve(); return; }
          try {
            sb.addEventListener("updateend", () => resolve(), { once: true });
            sb.remove(0, keepFrom);
          } catch { resolve(); }
        });

      const append = async (buf: ArrayBuffer) => {
        try {
          await once(buf);
        } catch {
          // QuotaExceededError is the documented signal for "make room", not
          // a failure. Anything else gets one retry too — the cost is a few
          // milliseconds and the alternative is losing the whole utterance.
          await evict();
          await once(buf);
        }
      };

      /**
       * Everything received so far.
       *
       * MediaSource is the fast path, not the only one, and it fails in ways
       * that are invisible from here — a phone with a tiny buffer, a
       * ManagedMediaSource that will not take another append. Keeping the
       * bytes means such a failure can fall back to plain blob playback
       * instead of ending in silence, which is what it did before. A minute
       * of speech is a few hundred kilobytes; the memory is not the problem.
       */
      const received: Uint8Array[] = [];

      /** Play what we have as one blob. The slow path, but it always works. */
      const blobFallback = async (current: ReadableStreamDefaultReader<Uint8Array>) => {
        try {
          for (;;) {
            const { done, value } = await current.read();
            if (done) break;
            if (value) received.push(value);
          }
        } catch { /* take whatever arrived */ }

        try { if (ms.readyState === "open") ms.endOfStream(); } catch { /* noop */ }
        if (received.length === 0) { opts?.onended?.(); return; }

        const blob = new Blob(received as BlobPart[], { type: "audio/mpeg" });
        audio.src = URL.createObjectURL(blob);
        audio.onended = opts?.onended ?? null;
        void start(audio);
      };

      (async () => {
        try {
          let current = reader;
          let next = res.headers.get("x-sage-next");

          for (;;) {
            const { done, value } = await current.read();

            if (done) {
              // A long answer arrives as several responses; keep appending
              // into the same buffer so it plays as one unbroken take.
              if (!next) break;
              const more = await segment(Number(next)).catch(() => null);
              if (!more?.ok || !more.body) break;
              next = more.headers.get("x-sage-next");
              current = more.body.getReader();
              continue;
            }

            if (value) {
              bytes += value.byteLength;
              received.push(value);
              const ab = new ArrayBuffer(value.byteLength);
              new Uint8Array(ab).set(value);
              try {
                await append(ab);
              } catch {
                // MediaSource has given up. Do not take the audio down with
                // it — finish reading and play the whole thing as a blob.
                await blobFallback(current);
                return;
              }
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
