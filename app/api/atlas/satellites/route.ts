import { NextResponse } from "next/server";
import * as satellite from "satellite.js";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const revalidate = 5;

interface Sat { name: string; lat: number; lon: number; alt: number }

// Cache TLEs for an hour; propagate fresh positions on each request.
const tleCache = new Map<string, { at: number; sats: { name: string; l1: string; l2: string }[] }>();

async function tles(group: string) {
  const hit = tleCache.get(group);
  if (hit && Date.now() - hit.at < 3600_000) return hit.sats;
  const res = await proxyFetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) return hit?.sats ?? [];
  const lines = (await res.text()).split(/\r?\n/).filter((l) => l.trim());
  const sats: { name: string; l1: string; l2: string }[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    if (lines[i] && lines[i + 1]?.startsWith("1 ") && lines[i + 2]?.startsWith("2 ")) {
      sats.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2] });
    }
  }
  tleCache.set(group, { at: Date.now(), sats });
  return sats;
}

export async function GET(req: Request) {
  const group = (new URL(req.url).searchParams.get("group") ?? "stations").replace(/[^a-z-]/gi, "") || "stations";
  const raw = await tles(group).catch(() => []);
  const now = new Date();
  const gmst = satellite.gstime(now);
  const out: Sat[] = [];
  for (const s of raw.slice(0, 60)) {
    try {
      const rec = satellite.twoline2satrec(s.l1, s.l2);
      const pv = satellite.propagate(rec, now);
      if (!pv || !pv.position || typeof pv.position === "boolean") continue;
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      out.push({ name: s.name, lat: satellite.degreesLat(geo.latitude), lon: satellite.degreesLong(geo.longitude), alt: Math.round(geo.height) });
    } catch {}
  }
  return NextResponse.json({ ok: true, data: out });
}
