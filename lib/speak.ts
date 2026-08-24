"use client";

import { splitIntoParts, handoffLine, splitForSpeech, SPEAK_CHUNK_CHARS } from "@/lib/speech-split";

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
  /**
   * Carry on to the next part by itself.
   *
   * On by default. Waiting to be asked was the right instinct for a five-minute
   * monologue and the wrong one for everything else: the morning brief, a long
   * answer, anything read out while he is walking or getting dressed simply
   * stopped a minute in and sat there. If he is not looking at the screen —
   * which is the entire point of speech — "say go on" is a dead end.
   *
   * Pass false where a deliberate pause is wanted.
   */
  autoContinue?: boolean;
}

/**
 * Which answer is currently being spoken.
 *
 * Bumped on every new one. The auto-continue chain checks it before speaking
 * the next part, so an answer that has been superseded — by a new question, by
 * `forgetRest`, by anything — stops instead of talking over its replacement.
 */
let session = 0;
let chainTimer: number | null = null;

/**
 * Is SAGE saying something right now?
 *
 * Starting a new utterance bumps `session`, which is how the auto-continue
 * chain knows to abandon the rest of the previous one — correct when a person
 * asks for something new, and destructive when it happens by itself.
 *
 * That is exactly what cut the morning brief off mid-sentence: the brief plays
 * as a chain of parts, the ambient poll fires every four minutes, and its only
 * guards were the voice *overlay* state and typing. It had no idea an
 * unrelated part of the app was mid-sentence, so it interrupted, took the
 * session with it, and the remaining parts were silently dropped.
 *
 * Exported so anything that might speak unprompted can check first.
 */
let speakingUntil = 0;
/** Elements already wired for lease bookkeeping — start() can be called twice
 *  on the same element when the blob fallback takes over. */
const leased = new WeakSet<HTMLAudioElement>();

export function isSpeaking(): boolean {
  if (pending) return true;
  if (typeof window !== "undefined" && window.speechSynthesis?.speaking) return true;
  return Date.now() < speakingUntil;
}

/**
 * Hold the "busy" flag open for a while.
 *
 * Audio playback gives no reliable "still going" signal across the streaming
 * and blob paths, so this is a lease that the player renews as it plays and
 * that lapses on its own if playback dies. A stale lease costs one skipped
 * ambient remark; no lease at all costs the end of the brief.
 */
export function markSpeaking(ms = 20_000): void {
  speakingUntil = Math.max(speakingUntil, Date.now() + ms);
}

/** Playback finished or was stopped — stop claiming the floor. */
export function releaseSpeaking(): void {
  speakingUntil = 0;
}

function stopChain() {
  if (chainTimer !== null) { clearTimeout(chainTimer); chainTimer = null; }
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
  releaseSpeaking();
  session += 1;
  stopChain();
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
  // Asked for explicitly, so cancel any pending automatic continuation rather
  // than letting both fire and speak the same part twice.
  stopChain();
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
 * Speak an answer, a minute at a time, without stopping.
 *
 * Long answers are still cut into parts — a part is one request to the
 * provider, one buffer, one thing that can fail on its own — but the parts are
 * played back to back with a breath between them, so what he hears is the
 * whole answer. Only the seams are engineered; the pause is not a decision
 * point unless someone asked for one.
 *
 * The caller's `onended` fires once, at the end of the last part. Firing it
 * per part told the UI the answer was finished four times over, which is how
 * the mic came back mid-sentence.
 */
export async function speakLowLatency(
  text: string,
  opts?: SpeakOpts,
): Promise<HTMLAudioElement | null> {
  const whole = text.trim();
  if (!whole) return null;

  const parts = splitIntoParts(whole);
  const auto = opts?.autoContinue !== false;

  // A new answer supersedes whatever was left of the last one.
  session += 1;
  stopChain();
  const mine = session;
  pending = parts.length > 1 ? { parts, index: 0, ...(opts ? { opts } : {}) } : null;

  const speakPart = (i: number): Promise<HTMLAudioElement | null> => {
    if (pending) pending.index = i;
    const last = i >= parts.length - 1;

    window.dispatchEvent(new CustomEvent("sage:voice-more", {
      detail: { remaining: Math.max(0, parts.length - 1 - i) },
    }));

    // The handoff line only makes sense when he is actually being asked. On
    // auto-continue it would announce a pause that is about to not happen.
    const line = !last && !auto ? `${parts[i]} ${handoffLine(i, parts.length)}` : parts[i];

    return speakOne(line, {
      ...opts,
      onended: () => {
        if (last) { pending = null; opts?.onended?.(); return; }
        if (!auto || mine !== session) { opts?.onended?.(); return; }
        // A beat between parts, so it reads as breathing rather than a fault.
        chainTimer = window.setTimeout(() => {
          chainTimer = null;
          if (mine === session) void speakPart(i + 1);
        }, 420) as unknown as number;
      },
    });
  };

  return speakPart(0);
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

  /**
   * A continuation, retried.
   *
   * A long brief is spoken as several requests back to back. The loop below
   * used to `break` the moment one of them failed, which ended the audio
   * mid-sentence with no error anywhere — the morning brief simply stopped
   * talking halfway through. A provider blip on piece three of seven should
   * cost a pause, not the other four pieces.
   */
  const segmentWithRetry = async (from: number): Promise<Response | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 250 * attempt));
      const res = await segment(from).catch(() => null);
      if (res?.ok && res.body) return res;
    }
    return null;
  };

  /** Whatever is left to say from piece `from` onwards, for the last resort. */
  const remainderFrom = (from: number): string =>
    splitForSpeech(clean, SPEAK_CHUNK_CHARS).slice(from).join(" ");

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
  const start = (audio: HTMLAudioElement) => {
    // Claim the floor while this element is actually playing, and renew the
    // lease as it goes so a long brief stays "busy" for its whole length.
    if (!leased.has(audio)) {
      leased.add(audio);
      audio.addEventListener("timeupdate", () => markSpeaking(15_000));
      audio.addEventListener("ended", releaseSpeaking);
      audio.addEventListener("pause", releaseSpeaking);
      audio.addEventListener("error", releaseSpeaking);
    }
    markSpeaking();
    return audio.play().then(
      () => true,
      (err: DOMException) => {
        if (err?.name === "NotAllowedError") {
          announce("TAP TO ENABLE VOICE", "Your browser blocked autoplay. Tap anywhere and SAGE will speak.");
          const resume = () => { audio.play().catch(() => {}); };
          window.addEventListener("pointerdown", resume, { once: true });
        } else {
          announce("VOICE PLAYBACK FAILED", `${provider}: ${err?.name ?? "unknown error"}`);
        }
        releaseSpeaking();
        return false;
      },
    );
  };

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
              const more = await segmentWithRetry(Number(next));
              if (!more?.body) {
                /**
                 * Every retry failed. Finishing in the browser's voice is worse
                 * than SAGE's, and far better than stopping mid-sentence — the
                 * point of a brief is that you heard all of it. Silence here is
                 * the one outcome that loses information.
                 */
                const rest = remainderFrom(Number(next));
                try { if (ms.readyState === "open") ms.endOfStream(); } catch { /* noop */ }
                if (rest.trim()) {
                  announce("VOICE INTERRUPTED", "Finishing the rest in the browser voice.");
                  browserSpeak(rest, opts?.onended);
                  return;
                }
                break;
              }
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

  /**
   * Chrome stops speaking after about fifteen seconds.
   *
   * Not an error, not an `onend` — the utterance simply stalls, which is why a
   * long paragraph in device mode always died mid-sentence. Poking pause/resume
   * on a timer keeps it going; it is a well-known workaround for a bug that has
   * been open for years, and there is no better one.
   */
  let keepalive: number | null = null;
  const stopKeepalive = () => { if (keepalive !== null) { clearInterval(keepalive); keepalive = null; } };
  const startKeepalive = () => {
    stopKeepalive();
    keepalive = window.setInterval(() => {
      if (!synth.speaking) { stopKeepalive(); return; }
      synth.pause();
      synth.resume();
    }, 10_000) as unknown as number;
  };

  const speakOne = (i: number) => {
    if (i >= chunks.length) { stopKeepalive(); onended?.(); return; }
    const u = new SpeechSynthesisUtterance(chunks[i]);
    const v = pickMaleVoice(synth);
    if (v) u.voice = v;
    u.rate = 0.95;  // natural, unhurried — not sluggish
    u.pitch = 0.82; // deep male
    u.onend = () => { stopKeepalive(); window.setTimeout(() => speakOne(i + 1), 300); }; // beat between paragraphs
    u.onerror = () => { stopKeepalive(); speakOne(i + 1); };
    synth.speak(u);
    startKeepalive();
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
