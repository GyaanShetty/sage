"use client";

/**
 * Marks the pane bodies that actually have something below the fold.
 *
 * The fade that signals "there is more here" was applied to every pane body
 * unconditionally, on the theory that it costs nothing when the content fits
 * because the faded band is empty. That was wrong, and measurably so: a
 * collapsed tile is 54px tall, so a 20px fade covers 37% of it, and the tile's
 * only two elements sit inside that band. It was dimming the readings on
 * Key Metrics, Mission Control, Markets and every collapsed strip on the wall
 * — data that was present, rendering, and greyed out.
 *
 * So the fade is now a class, and the class only goes on a body that really
 * does overflow. One observer set for the whole page, like the tilt driver.
 */

const CLASS = "is-cut";
/** Below this, the overflow is a rounding artefact rather than hidden content. */
const SLACK = 6;

let started = false;
let queued = false;
let ro: ResizeObserver | null = null;
let mo: MutationObserver | null = null;

function sweep() {
  queued = false;
  for (const el of document.querySelectorAll<HTMLElement>(".pane-body")) {
    el.classList.toggle(CLASS, el.scrollHeight - el.clientHeight > SLACK);
  }
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(sweep);
}

export function startOverflowWatch() {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  // Content arriving is the common case — a tile fetches, renders rows, and
  // only then overflows — so the mutation observer is the one that matters.
  mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });

  ro = new ResizeObserver(schedule);
  ro.observe(document.documentElement);

  window.addEventListener("resize", schedule, { passive: true });
  schedule();

  return () => {
    started = false;
    mo?.disconnect(); ro?.disconnect();
    window.removeEventListener("resize", schedule);
    for (const el of document.querySelectorAll<HTMLElement>(".pane-body")) el.classList.remove(CLASS);
  };
}
