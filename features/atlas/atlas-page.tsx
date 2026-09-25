"use client";

/**
 * The map at full size.
 *
 * The rail had a Maps stop pointing at /atlas, which was an API route and no
 * page — the link 404'd from the day I added it. The map itself had only ever
 * existed as a dashboard tile, so this is the page that link always meant.
 */

import { AtlasMap } from "@/features/atlas/atlas-map";
import { WorldMap } from "@/components/world-map";
import { Pane } from "@/components/pane";
import { TZ } from "@/lib/config";
import { useEffect, useState } from "react";

const HOME = { lat: 12.9716, lon: 77.5946, label: "Bengaluru" };
const LINKS = [
  { zone: "Europe/London", lat: 51.5072, lon: -0.1276, label: "London" },
  { zone: "America/New_York", lat: 40.7128, lon: -74.006, label: "New York" },
  { zone: "Asia/Tokyo", lat: 35.6762, lon: 139.6503, label: "Tokyo" },
  { zone: "Asia/Singapore", lat: 1.3521, lon: 103.8198, label: "Singapore" },
];

const hhmm = (zone: string, d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

export function AtlasPage() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const places = now
    ? LINKS.map((l) => ({ lat: l.lat, lon: l.lon, label: l.label, note: hhmm(l.zone, now) }))
    : [];

  return (
    <div className="atlas-page">
      <Pane n={1} title="Local" status="© OSM" live className="atlas-local" frame noZoom>
        <AtlasMap lat={HOME.lat} lon={HOME.lon} />
      </Pane>

      <Pane n={2} title="Global" status={`${LINKS.length} LINKS`} live noZoom>
        <div className="atlas-world">
          <WorldMap home={{ ...HOME, note: now ? hhmm(TZ, now) : "" }} places={places} />
        </div>
      </Pane>
    </div>
  );
}
