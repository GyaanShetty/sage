import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const revalidate = 20;

export interface Plane { lat: number; lon: number; callsign: string; origin: string; alt: number; vel: number; heading: number }
export interface Sky {
  iss: { lat: number; lon: number; alt: number; vel: number } | null;
  planes: Plane[];
  sun: { sunrise: string; sunset: string } | null;
  moon: { phase: number; illum: number; name: string };
}

function moonPhase(d = new Date()): { phase: number; illum: number; name: string } {
  // Conway-style approximation; phase 0..1 (0 = new, 0.5 = full).
  const synodic = 29.530588853;
  const known = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
  const days = (d.getTime() - known) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic / synodic;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const names = ["New", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  const name = names[Math.round(phase * 8) % 8];
  return { phase, illum, name };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat") ?? process.env.SAGE_LAT ?? 12.9716);
  const lon = Number(url.searchParams.get("lon") ?? process.env.SAGE_LON ?? 77.5946);

  const [issRes, planesRes, sunRes] = await Promise.all([
    proxyFetch("https://api.wheretheiss.at/v1/satellites/25544", { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    // OpenSky anonymous: live aircraft states in a box around the user (~±6°).
    proxyFetch(
      `https://opensky-network.org/api/states/all?lamin=${(lat - 6).toFixed(3)}&lomin=${(lon - 6).toFixed(3)}&lamax=${(lat + 6).toFixed(3)}&lomax=${(lon + 6).toFixed(3)}`,
      { signal: AbortSignal.timeout(9000) },
    )
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    proxyFetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&formatted=0`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  const iss = issRes
    ? { lat: issRes.latitude as number, lon: issRes.longitude as number, alt: issRes.altitude as number, vel: issRes.velocity as number }
    : null;

  const states = (planesRes?.states ?? []) as unknown[][];
  const planes: Plane[] = states
    .filter((s) => typeof s[6] === "number" && typeof s[5] === "number")
    .slice(0, 40)
    .map((s) => ({
      callsign: String(s[1] ?? "").trim() || "——",
      origin: String(s[2] ?? ""),
      lon: s[5] as number,
      lat: s[6] as number,
      alt: (s[13] as number) ?? (s[7] as number) ?? 0,
      vel: (s[9] as number) ?? 0,
      heading: (s[10] as number) ?? 0,
    }));

  const sun = sunRes?.status === "OK"
    ? { sunrise: sunRes.results.sunrise as string, sunset: sunRes.results.sunset as string }
    : null;

  const data: Sky = { iss, planes, sun, moon: moonPhase() };
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=20" } });
}
