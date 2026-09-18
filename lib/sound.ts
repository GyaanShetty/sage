"use client";

/**
 * Interface soundscape — synthesized, no audio files. Every cue is a few
 * oscillators or a noise burst through an envelope, tuned quiet and short so
 * it reads as machinery rather than notification spam.
 *
 * ── The thing that was broken ──────────────────────────────────────────────
 *
 * A browser creates an AudioContext SUSPENDED and only lets it run after a
 * real user gesture. Nothing here ever resumed it on a gesture — resume() was
 * called from inside the play path, which is too late and, on a page the user
 * has not yet touched, refused outright. Traced on a cold load: the boot
 * sequence built three oscillators against a suspended context, and the
 * context was still suspended after a click. The start-up chime had never
 * made a sound, and neither had the first cue after any gesture.
 *
 * So: one listener resumes the context on the first gesture of the session,
 * and cues scheduled before that are dropped rather than played into the
 * void — except the intro, which is worth holding briefly (see `arm`).
 */

const KEY = "sage-sound";
const VOL_KEY = "sage-volume";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let pending: (() => void) | null = null;
let pendingUntil = 0;

/* ── preferences ──────────────────────────────────────────────────────────── */

function on(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

/** 0..1, default 0.75. The cue peaks below are all relative to this. */
function volume(): number {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    if (raw === null) return 0.75;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.75;
  } catch { return 0.75; }
}

function setVolume(v: number) {
  const n = Math.max(0, Math.min(1, v));
  try { localStorage.setItem(VOL_KEY, String(n)); } catch {}
  if (master && ctx) master.gain.setTargetAtTime(n, ctx.currentTime, 0.01);
  if (n > 0) tick();
}

/* ── the context ──────────────────────────────────────────────────────────── */

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = volume();
      master.connect(ctx.destination);
    }
    return ctx;
  } catch { return null; }
}

/** Where every cue connects. Never the raw destination, so volume works. */
function bus(): AudioNode | null {
  const a = ac();
  return a ? (master ?? a.destination) : null;
}

/**
 * True when the context is actually running. A cue that plays against a
 * suspended context is silent AND leaves a scheduled node behind, so
 * everything below returns early instead.
 */
function live(): boolean {
  const a = ac();
  return !!a && a.state === "running" && on();
}

/**
 * Hold a cue for the first gesture, briefly.
 *
 * The start-up sequence runs before anyone has touched the page, so it can
 * never play on its own. If a gesture arrives within the window it fires
 * then, a second or two late, which is the difference between an intro and
 * no intro. Past the window it is dropped — a boot chime five minutes into a
 * session is nonsense, not a feature.
 */
function arm(fn: () => void, withinMs = 12_000) {
  pending = fn;
  pendingUntil = Date.now() + withinMs;
}

export function unlockAudio() {
  if (unlocked || typeof window === "undefined") return () => {};
  const go = () => {
    const a = ac();
    if (!a) return;
    a.resume()
      .then(() => {
        unlocked = true;
        if (pending && Date.now() < pendingUntil) { const f = pending; pending = null; f(); }
        else pending = null;
      })
      .catch(() => {});
    window.removeEventListener("pointerdown", go);
    window.removeEventListener("keydown", go);
    window.removeEventListener("touchstart", go);
  };
  window.addEventListener("pointerdown", go, { once: true });
  window.addEventListener("keydown", go, { once: true });
  window.addEventListener("touchstart", go, { once: true });
  return () => {
    window.removeEventListener("pointerdown", go);
    window.removeEventListener("keydown", go);
    window.removeEventListener("touchstart", go);
  };
}

/* ── building blocks ──────────────────────────────────────────────────────── */

function env(a: AudioContext, peak: number, dur: number, at = 0): GainNode {
  const g = a.createGain();
  const t = a.currentTime + at;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(bus()!);
  return g;
}

function beep(hz: number, peak: number, dur: number, type: OscillatorType = "sine", at = 0, glideTo?: number) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  o.connect(env(a, peak, dur, at));
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** A burst of filtered noise — clicks, clacks, swooshes, risers. */
function noise(opts: {
  dur: number; peak: number; from: number; to?: number;
  q?: number; type?: BiquadFilterType; at?: number; decay?: boolean;
}) {
  const a = ac();
  if (!a) return;
  const at = opts.at ?? 0;
  const t = a.currentTime + at;
  const len = Math.max(1, Math.floor(a.sampleRate * opts.dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * (opts.decay === false ? 1 : 1 - i / len);
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.Q.value = opts.q ?? 1.4;
  f.frequency.setValueAtTime(opts.from, t);
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
  src.connect(f);
  f.connect(env(a, opts.peak, opts.dur + 0.02, at));
  src.start(t);
}

/* ── the cues ─────────────────────────────────────────────────────────────── */

/** Soft high tick — toasts, small confirmations. */
function tick() { if (live()) beep(1680, 0.045, 0.09); }

/** Dry mechanical detent — a dial passing a notch. */
function detent() { if (live()) noise({ dur: 0.03, peak: 0.06, from: 2400 }); }

/** Rising two-note blip — a directive completed. */
function blip() { if (live()) beep(540, 0.06, 0.16, "sine", 0, 880); }

/** Filtered-noise swoosh — voice link engaging. */
function swoosh() { if (live()) noise({ dur: 0.35, peak: 0.09, from: 320, to: 2600 }); }

/** Near-subliminal edge tick — a keycard taking the pointer. */
let lastHover = 0;
function hover() {
  if (!live()) return;
  const now = performance.now();
  // A wall of eighteen tiles under a moving pointer would otherwise fire this
  // dozens of times a second, which is a machine gun, not an interface.
  if (now - lastHover < 90) return;
  lastHover = now;
  beep(2100, 0.012, 0.035, "sine");
}

/** Page change — short air-move, no pitch, so it never sounds like an alert. */
function nav() { if (live()) noise({ dur: 0.16, peak: 0.05, from: 900, to: 220, q: 0.8 }); }

/** A switch throwing. Up and down differ, so the state is audible. */
function latch(state: boolean) {
  if (!live()) return;
  noise({ dur: 0.028, peak: 0.07, from: state ? 3000 : 1500 });
  beep(state ? 880 : 440, 0.03, 0.06, "square", 0.02);
}

/** Something needs a decision. Two falling notes — never a rising alarm. */
function alert() {
  if (!live()) return;
  beep(740, 0.05, 0.14, "triangle");
  beep(554, 0.05, 0.22, "triangle", 0.13);
}

/** Something failed. Low, short, unmistakably not a success. */
function error() {
  if (!live()) return;
  beep(180, 0.06, 0.22, "sawtooth", 0, 120);
  noise({ dur: 0.1, peak: 0.03, from: 400, q: 0.7 });
}

/** Work finished. The blip, resolved a fifth higher. */
function success() {
  if (!live()) return;
  beep(660, 0.05, 0.1, "sine");
  beep(880, 0.05, 0.1, "sine", 0.08);
  beep(1320, 0.03, 0.22, "sine", 0.16);
}

/** A key going down in the terminal. Quiet enough to type through. */
function key() { if (live()) noise({ dur: 0.02, peak: 0.028, from: 1800, q: 2 }); }

/* ── the start-up suite ───────────────────────────────────────────────────── */

/** Power coming up: a sub thump under a rising hum. */
function power() {
  if (!live()) return;
  beep(38, 0.16, 1.1, "sine", 0, 62);
  beep(110, 0.05, 1.4, "triangle", 0.05, 220);
  noise({ dur: 1.2, peak: 0.022, from: 120, to: 1400, q: 0.6, decay: false });
}

/** One relay closing — a check line printing. Pitch climbs with the index. */
function relay(i = 0) {
  if (!live()) return;
  noise({ dur: 0.035, peak: 0.055, from: 1500 + i * 260, q: 2.2 });
  beep(320 + i * 90, 0.022, 0.05, "square", 0.012);
}

/** Tension before the resolve. */
function riser(dur = 0.7) {
  if (!live()) return;
  noise({ dur, peak: 0.05, from: 300, to: 5200, q: 0.9, decay: false });
  beep(220, 0.03, dur, "sawtooth", 0, 660);
}

/** Boot chime — perfect fifth with a shimmer partial. */
function chime() {
  if (!live()) return;
  ([[440, 0, 0.7, 0.05], [659.25, 0.09, 0.62, 0.05], [1318.5, 0.19, 0.5, 0.02]] as const)
    .forEach(([hz, at, dur, peak]) => beep(hz, peak, dur, "sine", at));
}

/**
 * The whole start-up, as one call.
 *
 * Armed rather than played when the page has not been touched yet, because
 * that is the normal case for a cold load and the alternative is silence.
 */
function intro(lines = 6) {
  const run = () => {
    power();
    for (let i = 0; i < lines; i++) setTimeout(() => relay(i), 260 + i * 190);
    setTimeout(() => riser(0.66), 260 + lines * 190);
    setTimeout(() => chime(), 260 + lines * 190 + 620);
  };
  if (!on()) return;
  if (live()) run();
  else arm(run);
}

/* ── master switch ────────────────────────────────────────────────────────── */

function toggle(): boolean {
  const next = !on();
  try { localStorage.setItem(KEY, next ? "on" : "off"); } catch {}
  if (next) {
    // Turning sound ON is itself a gesture, so this is the one moment the
    // context is guaranteed resumable.
    ac()?.resume().then(() => { unlocked = true; latch(true); }).catch(() => {});
  }
  return next;
}

export const sound = {
  // existing vocabulary — callers depend on these names
  tick, detent, blip, swoosh, chime, toggle, isOn: on,
  // added
  hover, nav, latch, alert, error, success, key,
  power, relay, riser, intro,
  volume, setVolume, unlock: unlockAudio,
};
