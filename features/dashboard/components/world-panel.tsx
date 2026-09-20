"use client";

/**
 * Global map: home, and the cities SAGE keeps a clock for.
 *
 * The same three zones the World Clocks tile shows, on a map, with each one's
 * current local time under its name. Same data, different question — the
 * clocks answer "what time is it there", this answers "where is there".
 */

import { useEffect, useState } from "react";
import { Pane } from "@/components/pane";
import { WorldMap, type Place } from "@/components/world-map";
import { TZ } from "@/lib/config";

/** Coordinates for the zones the clock tile carries. */
const HOME: Omit<Place, "note"> = { lat: 12.9716, lon: 77.5946, label: "Bengaluru" };
const LINKS: { zone: string; lat: number; lon: number; label: string }[] = [
  { zone: "Europe/London", lat: 51.5072, lon: -0.1276, label: "London" },
  { zone: "America/New_York", lat: 40.7128, lon: -74.006, label: "New York" },
  { zone: "Asia/Tokyo", lat: 35.6762, lon: 139.6503, label: "Tokyo" },
  { zone: "Asia/Singapore", lat: 1.3521, lon: 103.8198, label: "Singapore" },
];

const hhmm = (zone: string, d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

export function WorldPanel({ n }: { n?: number }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [home, setHome] = useState<Place>({ ...HOME, note: "" });

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setPlaces(LINKS.map((l) => ({ lat: l.lat, lon: l.lon, label: l.label, note: hhmm(l.zone, d) })));
      setHome({ ...HOME, note: hhmm(TZ, d) });
    };
    tick();
    // Minute granularity: the labels are hours and minutes.
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Pane n={n} title="Global Map" status={`${LINKS.length} LINKS`} live noZoom>
      <div className="wmap-wrap">
        <WorldMap home={home} places={places} />
      </div>
    </Pane>
  );
}
