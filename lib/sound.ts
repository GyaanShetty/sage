"use client";

/**
 * Interface soundscape — synthesized, no audio files. Every cue is a few
 * oscillators/noise through an envelope, tuned quiet and short so it reads
 * as machinery, not notification spam. Master switch persists.
 */

let ctx: AudioContext | null = null;

function on(): boolean {
  try {
    return localStorage.getItem("sage-sound") !== "off";
  } catch {
    return true;
  }
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function env(a: AudioContext, peak: number, dur: number): GainNode {
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(peak, a.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  g.connect(a.destination);
  return g;
}

/** Soft high tick — toasts, small confirmations. */
function tick() {
  if (!on()) return;
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  o.type = "sine";
  o.frequency.value = 1680;
  o.connect(env(a, 0.045, 0.09));
  o.start();
  o.stop(a.currentTime + 0.1);
}

/** Rising two-note blip — a directive completed. */
function blip() {
  if (!on()) return;
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(540, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(880, a.currentTime + 0.11);
  o.connect(env(a, 0.06, 0.16));
  o.start();
  o.stop(a.currentTime + 0.18);
}

/** Filtered-noise swoosh — voice link engaging. */
function swoosh() {
  if (!on()) return;
  const a = ac();
  if (!a) return;
  const len = a.sampleRate * 0.35;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(320, a.currentTime);
  f.frequency.exponentialRampToValueAtTime(2600, a.currentTime + 0.3);
  src.connect(f);
  f.connect(env(a, 0.09, 0.34));
  src.start();
}

/** Boot chime — perfect fifth with a shimmer partial. */
function chime() {
  if (!on()) return;
  const a = ac();
  if (!a) return;
  [[440, 0, 0.7], [659.25, 0.09, 0.62], [1318.5, 0.19, 0.5]].forEach(([hz, delay, dur]) => {
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.value = hz;
    const g = a.createGain();
    const t = a.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(hz > 1000 ? 0.02 : 0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(a.destination);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

function toggle(): boolean {
  const next = !on();
  try {
    localStorage.setItem("sage-sound", next ? "on" : "off");
  } catch {}
  if (next) tick();
  return next;
}

export const sound = { tick, blip, swoosh, chime, toggle, isOn: on };
