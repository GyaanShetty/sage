import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Everything happening on the planet right now that is published for free.
 *
 * Modelled on God's Eye View (bilawalsidhu/gods-eye-view), whose premise is
 * the good one: these signals are already public — seismographs, transponders,
 * orbital elements, hurricane advisories — and the only thing missing is
 * somewhere to see them together.
 *
 * Four feeds here, and the choosing was done by fetching rather than by
 * reading documentation. Wildfire perimeters were in the plan and are not
 * here: the NIFC service answers 9.6MB for a single unfiltered query and its
 * point layer uses field names that do not match its own docs, so it was cut
 * rather than shipped half-working. Aircraft and satellites already have their
 * own routes in SAGE and are layered on the client.
 *
 * Settled individually, so a quiet USGS does not cost you the hurricanes.
 */

export interface Quake {
  id: string; mag: number; place: string; lat: number; lon: number;
  depth: number; at: number; url: string; tsunami: boolean;
}
export interface Storm {
  id: string; name: string; classification: string; lat: number; lon: number;
  intensityKt: number | null; pressureMb: number | null; movement: string | null;
}
export interface Launch {
  id: string; name: string; provider: string; at: string; pad: string;
  country: string; status: string;
}

const UA = { "user-agent": "Mozilla/5.0 (compatible; SAGE/0.2)" };
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** USGS, every quake in the last day. Public domain, keyless, 4-minute lag. */
async function quakes(): Promise<Quake[]> {
  const res = await proxyFetch(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    { signal: AbortSignal.timeout(9000), headers: UA },
  );
  if (!res.ok) throw new Error(String(res.status));
  const j = (await res.json()) as { features?: { id: string; properties: Record<string, unknown>; geometry: { coordinates: number[] } }[] };
  return (j.features ?? [])
    .map((f) => ({
      id: f.id,
      mag: num(f.properties.mag) ?? 0,
      place: String(f.properties.place ?? "—"),
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2] ?? 0,
      at: num(f.properties.time) ?? Date.now(),
      url: String(f.properties.url ?? ""),
      tsunami: f.properties.tsunami === 1,
    }))
    // Everything below about 2.5 is instrument noise as far as a world map is
    // concerned — there are hundreds a day and none of them are events.
    .filter((q) => q.mag >= 2.5)
    .sort((a, b) => b.mag - a.mag)
    .slice(0, 120);
}

/** NOAA's National Hurricane Center: live Atlantic and Pacific advisories. */
async function storms(): Promise<Storm[]> {
  const res = await proxyFetch("https://www.nhc.noaa.gov/CurrentStorms.json", {
    signal: AbortSignal.timeout(9000), headers: UA,
  });
  if (!res.ok) throw new Error(String(res.status));
  const j = (await res.json()) as { activeStorms?: Record<string, unknown>[] };
  return (j.activeStorms ?? []).map((s) => ({
    id: String(s.id ?? ""),
    name: String(s.name ?? "—"),
    classification: String(s.classification ?? ""),
    lat: num(s.latitudeNumeric) ?? 0,
    lon: num(s.longitudeNumeric) ?? 0,
    intensityKt: num(Number(s.intensity)),
    pressureMb: num(Number(s.pressure)),
    movement: s.movementDir != null && s.movementSpeed != null
      ? `${s.movementDir}° at ${s.movementSpeed}kt` : null,
  })).filter((s) => s.id);
}

/** The Space Devs' Launch Library: what is going up next, anywhere. */
async function launches(): Promise<Launch[]> {
  const res = await proxyFetch(
    "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=12&mode=list",
    { signal: AbortSignal.timeout(9000), headers: UA },
  );
  if (!res.ok) throw new Error(String(res.status));
  const j = (await res.json()) as { results?: Record<string, unknown>[] };
  return (j.results ?? []).map((l) => {
    const pad = l.pad as Record<string, unknown> | undefined;
    const loc = pad?.location as Record<string, unknown> | undefined;
    return {
      id: String(l.id ?? ""),
      name: String(l.name ?? "—"),
      provider: String((l.launch_service_provider as Record<string, unknown>)?.name ?? "—"),
      at: String(l.net ?? ""),
      pad: String(pad?.name ?? loc?.name ?? "—"),
      country: String(loc?.country_code ?? ""),
      status: String((l.status as Record<string, unknown>)?.abbrev ?? ""),
    };
  }).filter((l) => l.id);
}

export async function GET() {
  const [q, s, l] = await Promise.allSettled([quakes(), storms(), launches()]);

  const data = {
    quakes: q.status === "fulfilled" ? q.value : [],
    storms: s.status === "fulfilled" ? s.value : [],
    launches: l.status === "fulfilled" ? l.value : [],
    /* Named so the HUD can say which eye is shut rather than drawing an empty
       layer that looks like a quiet day. */
    down: [
      q.status === "rejected" && "seismic",
      s.status === "rejected" && "cyclones",
      l.status === "rejected" && "launches",
    ].filter(Boolean) as string[],
    at: Date.now(),
  };
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=120" } });
}
