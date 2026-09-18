"use client";

import { useEffect, useState } from "react";

export const HUE_KEY = "sage-hue";
/** Amber, the terminal default. Kept in one place so reset means one thing. */
export const HUE_DEFAULT = 32;

/** Named stops, so the dial is usable without knowing what a hue angle is. */
export const HUE_PRESETS: { h: number; name: string }[] = [
  { h: 32, name: "Amber" },
  { h: 3, name: "Signal red" },
  { h: 47, name: "Gold" },
  { h: 96, name: "Acid" },
  { h: 152, name: "Mint" },
  { h: 188, name: "Ice" },
  { h: 208, name: "Azure" },
  { h: 260, name: "Violet" },
  { h: 300, name: "Magenta" },
];

const clamp = (n: number) => Math.max(0, Math.min(359, Math.round(n)));

export function readHue(): number {
  try {
    const raw = localStorage.getItem(HUE_KEY);
    if (raw === null) return HUE_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n) : HUE_DEFAULT;
  } catch {
    return HUE_DEFAULT;
  }
}

export function applyHue(h: number) {
  document.documentElement.style.setProperty("--hue", String(clamp(h)));
}

/**
 * The hue, as state.
 *
 * Reads in an effect rather than during render: localStorage is not available
 * on the server, and seeding state from it directly makes the first client
 * render disagree with the markup React sent. The pre-paint script in the
 * layout has already applied the stored value to the document, so there is no
 * flash while this settles — the dial's own position is the only thing
 * catching up.
 */
export function useHue(): [number, (h: number) => void] {
  const [hue, setHue] = useState(HUE_DEFAULT);

  useEffect(() => { setHue(readHue()); }, []);

  const set = (h: number) => {
    const v = clamp(h);
    setHue(v);
    applyHue(v);
    try { localStorage.setItem(HUE_KEY, String(v)); } catch {}
    // Other mounted dials (settings and the quick control) follow along.
    window.dispatchEvent(new CustomEvent("sage-hue", { detail: v }));
  };

  useEffect(() => {
    const on = (e: Event) => setHue((e as CustomEvent<number>).detail);
    window.addEventListener("sage-hue", on);
    return () => window.removeEventListener("sage-hue", on);
  }, []);

  return [hue, set];
}
