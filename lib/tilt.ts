"use client";

/**
 * Keycard tilt.
 *
 * One pointermove listener on the document, not one per pane. A wall carries
 * thirty panes; thirty listeners each doing their own getBoundingClientRect
 * on every mouse move is how a dashboard starts dropping frames for an
 * effect nobody asked to pay for.
 *
 * The pane under the pointer gets --tx/--ty (its own -1..1 offset from
 * centre) and a lit flag; CSS does the rest. Rects are measured on enter and
 * cached until the pointer leaves, so moving across a card costs arithmetic
 * rather than layout.
 */

const MAX = 1;

let current: HTMLElement | null = null;
let rect: DOMRect | null = null;
let started = false;

function clear() {
  if (!current) return;
  current.style.removeProperty("--tx");
  current.style.removeProperty("--ty");
  current.classList.remove("is-tilted");
  current = null;
  rect = null;
}

function onMove(e: PointerEvent) {
  // Touch drags scroll the page; a card that tips under the thumb fights it.
  if (e.pointerType !== "mouse") return;

  const el = (e.target as Element | null)?.closest?.(".pane") as HTMLElement | null;
  if (!el) return clear();

  if (el !== current) {
    clear();
    current = el;
    rect = el.getBoundingClientRect();
    el.classList.add("is-tilted");
  }
  if (!rect) return;

  const x = (e.clientX - rect.left) / rect.width - 0.5;
  const y = (e.clientY - rect.top) / rect.height - 0.5;
  el.style.setProperty("--tx", String(Math.max(-MAX, Math.min(MAX, x * 2))));
  el.style.setProperty("--ty", String(Math.max(-MAX, Math.min(MAX, y * 2))));
}

/** Idempotent: mounting a second consumer must not add a second listener. */
export function startTilt() {
  if (started || typeof window === "undefined") return () => {};
  // The whole effect is motion. Somebody who has asked for less of it gets
  // the flat card, which is the same card.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  started = true;
  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerleave", clear);
  window.addEventListener("scroll", clear, { passive: true });
  return () => {
    started = false;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerleave", clear);
    window.removeEventListener("scroll", clear);
    clear();
  };
}
