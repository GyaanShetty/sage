import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const revalidate = 300;

/** Live earthquakes, last 24h, M2.5+ (USGS, keyless). */
export async function GET() {
  try {
    const res = await proxyFetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return NextResponse.json({ ok: true, data: [] });
    const j = (await res.json()) as { features: { properties: { mag: number; place: string; time: number }; geometry: { coordinates: number[] } }[] };
    const data = j.features.map((f) => ({
      mag: f.properties.mag,
      place: f.properties.place,
      time: f.properties.time,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
    }));
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ ok: true, data: [] });
  }
}
