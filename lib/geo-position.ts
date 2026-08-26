"use client";

import { useEffect, useState } from "react";

/**
 * Where he actually is, continuously.
 *
 * ── Why this is shared rather than per-component ───────────────────────────
 *
 * The app already asked for a position once — features/dashboard/geo-map.tsx
 * called getCurrentPosition and kept the answer in a ref that nothing else
 * could see. So the atlas, the weather and the ambient layer all had no idea
 * where he was, while a second component two panels away did. One watch,
 * shared, fixes that and also stops two components racing for the same
 * permission prompt.
 *
 * `watchPosition`, not `getCurrentPosition`: he asked for real time, and a
 * one-shot fix goes stale the moment he moves.
 */

export interface Position {
  lat: number;
  lon: number;
  /** Metres. Worth showing — a 2km fix and a 5m fix mean different things. */
  accuracy: number;
  at: number;
}

export type GeoState = "idle" | "locating" | "live" | "denied" | "unavailable";

let watchId: number | null = null;
let latest: Position | null = null;
let state: GeoState = "idle";
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

function startWatch(): void {
  if (watchId !== null || typeof navigator === "undefined" || !navigator.geolocation) {
    if (!navigator?.geolocation) { state = "unavailable"; notify(); }
    return;
  }
  state = "locating";
  notify();

  watchId = navigator.geolocation.watchPosition(
    (p) => {
      latest = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
      state = "live";
      notify();
    },
    (err) => {
      // PERMISSION_DENIED is 1. Distinguished from a timeout because the
      // remedies are different: one needs a browser setting changed, the
      // other just needs another moment or a clearer view of the sky.
      state = err.code === 1 ? "denied" : "unavailable";
      notify();
    },
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
  );
}

/**
 * Subscribe to his position.
 *
 * Nothing is requested until a component actually asks — mounting the app must
 * not throw a permission prompt at him before he has done anything.
 */
export function useLivePosition(enabled = true): { position: Position | null; state: GeoState } {
  const [, force] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    startWatch();
    return () => {
      listeners.delete(listener);
      // The watch outlives any one component on purpose: tearing it down when
      // a panel unmounts would re-prompt and re-acquire on the next mount,
      // which is both slower and more annoying than keeping one watch open.
    };
  }, [enabled]);

  return { position: latest, state };
}

/** Stop watching — for a settings toggle, or when the page is put away. */
export function stopWatching(): void {
  if (watchId !== null && navigator?.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    state = "idle";
    notify();
  }
}
