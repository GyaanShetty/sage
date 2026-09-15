"use client";

/**
 * One clock for every piece of ASCII on the screen.
 *
 * The obvious way to animate a dozen loading panes is a setInterval each, and
 * that is how a dashboard ends up with thirty timers running in the
 * background — the exact thing that was quietly costing a frame every 45
 * seconds on the wall before it was removed.
 *
 * So: a single interval, started when the first subscriber arrives and
 * stopped when the last leaves. Subscribers get a frame number and decide
 * what to draw from it — no per-element state, no per-element timer.
 *
 * Two things it refuses to do:
 *
 *   · Run while the tab is hidden. Animating glyphs nobody can see is pure
 *     battery, and on a phone that is somebody's afternoon.
 *   · Run at all under prefers-reduced-motion. Consumers render frame zero,
 *     which is the finished state — the art stays, the motion goes.
 */

import { useEffect, useState } from "react";

const FPS = 12;                       // fast enough to read as motion, slow enough to be free
const subscribers = new Set<(frame: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let frame = 0;

function reduced(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function tick() {
  if (document.hidden) return;
  frame += 1;
  for (const fn of subscribers) fn(frame);
}

function start() {
  if (timer || reduced()) return;
  timer = setInterval(tick, 1000 / FPS);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/**
 * The current frame, shared with everything else animating.
 *
 * Returns 0 forever when motion is reduced, so a consumer written as
 * "resolve by frame N" simply starts resolved.
 */
export function useAsciiFrame(): number {
  const [f, setF] = useState(0);

  useEffect(() => {
    if (reduced()) return;

    subscribers.add(setF);
    start();

    // Coming back to the tab should not replay from wherever it froze.
    const onVisible = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      subscribers.delete(setF);
      document.removeEventListener("visibilitychange", onVisible);
      if (subscribers.size === 0) stop();
    };
  }, []);

  return f;
}

/**
 * A deterministic glyph for a cell that has not resolved yet.
 *
 * Derived from position and frame rather than Math.random so a re-render
 * between ticks does not reshuffle the noise — flicker that changes on every
 * paint reads as a rendering fault rather than an effect.
 */
const NOISE = "▖▗▘▝▚▞░▒▓█◢◣◤◥╱╲┃━╋┫┣";

export function noiseGlyph(i: number, frame: number): string {
  const h = Math.abs(Math.imul(i * 2654435761 + frame * 40503, 2246822519)) >>> 8;
  return NOISE[h % NOISE.length];
}
