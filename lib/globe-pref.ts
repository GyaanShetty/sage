"use client";

import { useEffect, useState } from "react";

/**
 * Whether the 3D globe runs at all.
 *
 * It is the most expensive thing SAGE draws: a WebGL scene with a continuous
 * render loop, rebuilt whenever its layers change, polling satellites every
 * five seconds. On a laptop it is a centrepiece; on a warm machine or a
 * battery it is the reason the whole app feels sticky.
 *
 * So it is a choice, and the choice is remembered. Stored in localStorage
 * rather than the database on purpose: it describes this device's appetite for
 * graphics, and the right answer on a desktop is often the wrong one on a
 * phone.
 */

const KEY = "sage-globe";
const EVENT = "sage:globe-pref";

export function globeEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setGlobeEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode — the toggle still works for this session */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

/**
 * The preference, kept in sync across every component that shows it.
 *
 * Starts as `true` on the server and on the first client render, then
 * corrects itself in an effect: reading localStorage during render would
 * produce different markup on the two sides and React would rightly complain.
 * `ready` lets a caller avoid mounting an expensive scene during that one
 * frame of uncertainty.
 */
export function useGlobeEnabled(): { on: boolean; ready: boolean; set: (v: boolean) => void } {
  const [on, setOn] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOn(globeEnabled());
    setReady(true);

    const sync = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    // `storage` covers the other tab; the custom event covers this one.
    const cross = (e: StorageEvent) => { if (e.key === KEY) setOn(globeEnabled()); };
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", cross);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", cross);
    };
  }, []);

  return { on, ready, set: setGlobeEnabled };
}
