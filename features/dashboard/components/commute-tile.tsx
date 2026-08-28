"use client";

import { useEffect, useState } from "react";
import { Pane } from "@/components/pane";
import { useLivePosition } from "@/lib/geo-position";
import { useLive } from "@/lib/live";
import { distanceM, type Place } from "@/core/places/schedule";

/**
 * How far everything is, right now.
 *
 * The `HOME→COLLEGE 42M` readout from the reference, built for real: every
 * saved place, with live driving time from wherever he actually is.
 *
 * Two things it deliberately does not do:
 *
 * - It does not route to a place he is standing in. "9 minutes to the gym"
 *   while inside the gym is worse than silence, because it looks like an
 *   answer. Under 150m the row says HERE.
 * - It does not recompute on every GPS tick. `watchPosition` fires constantly
 *   and OSRM is a public demo server; the position is rounded to roughly 200m
 *   before it is allowed to trigger new routing, the same guard the Atlas uses
 *   for the route it draws.
 */

interface Leg { place: Place; meters: number; seconds: number; here: boolean }

/** Below this, he is at the place rather than travelling to it. */
const AT_PLACE_M = 150;

export function CommuteTile({ n }: { n?: number }) {
  const { position, state } = useLivePosition();
  const [places, setPlaces] = useState<Place[]>([]);
  const [legs, setLegs] = useState<Leg[] | null>(null);

  useLive(
    () => fetch("/api/places").then((r) => r.json()).then((j) => setPlaces(j?.data ?? [])).catch(() => {}),
    { everyMs: 300_000, scopes: ["places"] },
  );

  // Rounded so a stationary phone's jitter cannot start a routing storm.
  const fix = position ? `${Math.round(position.lat * 500)},${Math.round(position.lon * 500)}` : "";

  useEffect(() => {
    if (!position || places.length === 0) { setLegs(null); return; }
    let cancelled = false;

    (async () => {
      const out: Leg[] = [];
      for (const p of places) {
        const straight = distanceM(position, p);
        if (straight < AT_PLACE_M) { out.push({ place: p, meters: 0, seconds: 0, here: true }); continue; }
        try {
          const q = new URLSearchParams({
            fromLat: String(position.lat), fromLon: String(position.lon),
            toLat: String(p.lat), toLon: String(p.lon), profile: "driving",
          });
          const j = await fetch(`/api/route?${q}`).then((r) => r.json());
          if (cancelled) return;
          if (j?.ok) out.push({ place: p, meters: j.data.meters, seconds: j.data.seconds, here: false });
        } catch { /* a leg that will not route is left out rather than guessed */ }
      }
      if (!cancelled) setLegs(out.sort((a, b) => a.seconds - b.seconds));
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, places]);

  const mins = (s: number) => (s < 60 ? "<1M" : `${Math.round(s / 60)}M`);

  return (
    <Pane
      n={n}
      title="Commute"
      status={state === "live" ? "LIVE" : state === "denied" ? "NO POSITION" : state === "locating" ? "ACQUIRING" : "OFF"}
      live={state === "live"}
    >
      {state === "denied" && <div className="tile-wait">LOCATION BLOCKED — ALLOW IT TO SEE TRAVEL TIMES</div>}
      {state !== "denied" && places.length === 0 && <div className="tile-wait">NO SAVED PLACES — RIGHT-CLICK THE MAP</div>}
      {state !== "denied" && places.length > 0 && !legs && <div className="tile-wait">ACQUIRING…</div>}
      {legs?.map((l) => (
        <div className="trow" key={l.place.id}>
          <span className="trow-k">{l.place.name}</span>
          {l.here ? (
            <span className="trow-v signal">HERE</span>
          ) : (
            <span className="trow-v">
              {(l.meters / 1000).toFixed(1)} KM <b className="cm-t">{mins(l.seconds)}</b>
            </span>
          )}
        </div>
      ))}
    </Pane>
  );
}
