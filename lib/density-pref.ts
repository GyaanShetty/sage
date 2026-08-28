"use client";

import { useEffect, useState } from "react";

/**
 * How much room the interface gives itself.
 *
 * SAGE is laid out for a wide window. In half a laptop screen the same spacing
 * that reads as considered starts costing whole panels below the fold, and the
 * right trade there is different from the one at full width — which is a
 * judgement about how you are working, not something a breakpoint can infer.
 *
 * Compact only changes spacing and scale. It never hides a feature: a density
 * control that removes things is not a density control, it is a worse version
 * of the app.
 *
 * Stored per device, like the globe preference, because the answer on a
 * desktop is routinely the wrong one on a laptop in split screen.
 */

export type Density = "comfortable" | "compact";

const KEY = "sage-density";
const EVENT = "sage:density-pref";
const ATTR = "data-density";

export function density(): Density {
  // Compact is the shipped default. This is a terminal: the point is how much
  // is on screen at once, and the comfortable spacing was costing whole panels
  // below the fold. "comfortable" remains one toggle away and still hides
  // nothing — only the room things take up changes.
  if (typeof window === "undefined") return "compact";
  try {
    return window.localStorage.getItem(KEY) === "comfortable" ? "comfortable" : "compact";
  } catch {
    return "compact";
  }
}

/** Put it on <html>, where the stylesheet looks for it. */
export function applyDensity(value: Density): void {
  if (typeof document === "undefined") return;
  if (value === "compact") document.documentElement.setAttribute(ATTR, "compact");
  else document.documentElement.removeAttribute(ATTR);
}

export function setDensity(value: Density): void {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* private mode — the choice still holds for this session */
  }
  applyDensity(value);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}

/**
 * The preference, in sync across every component that shows it.
 *
 * Starts "comfortable" on the server and the first client render, then
 * corrects in an effect — reading localStorage during render would make the
 * two sides disagree and React would rightly complain.
 */
export function useDensity(): { value: Density; set: (v: Density) => void } {
  const [value, setValue] = useState<Density>("comfortable");

  useEffect(() => {
    const current = density();
    setValue(current);
    applyDensity(current);

    const sync = (e: Event) => setValue((e as CustomEvent<Density>).detail);
    // `storage` covers the other tab; the custom event covers this one.
    const cross = (e: StorageEvent) => { if (e.key === KEY) { const d = density(); setValue(d); applyDensity(d); } };
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", cross);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", cross);
    };
  }, []);

  return { value, set: setDensity };
}
