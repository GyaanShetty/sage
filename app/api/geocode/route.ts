import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Find a place by name.
 *
 * Nominatim — keyless, and the same family as the OSM tiles and the OSRM
 * routing already in use, so the names it returns match the names on the map.
 *
 * Server-side deliberately, for the same reason routing is: a geocode request
 * from the browser carries his IP and, with `viewbox`, roughly where he is
 * looking. Proxying it means the only thing Nominatim learns is that SAGE
 * asked.
 *
 * Nominatim's usage policy asks for at most one request a second and a real
 * User-Agent. The caller debounces; the cache below does the rest.
 */
export const revalidate = 3600;

interface Hit { name: string; lat: number; lon: number; kind?: string }

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const query = (q.get("q") ?? "").trim();
  if (query.length < 3) return NextResponse.json({ ok: true, data: [] });

  // Bias toward where he is looking, when the caller says. Results elsewhere
  // are still returned — bounded is a preference, not a filter.
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  const near = Number.isFinite(lat) && Number.isFinite(lon);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "0");
  if (near) {
    url.searchParams.set("viewbox", [lon - 0.6, lat + 0.6, lon + 0.6, lat - 0.6].join(","));
  }

  try {
    const res = await proxyFetch(url.toString(), {
      headers: { "user-agent": "SAGE personal assistant (github.com/GyaanShetty/sage)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: `geocoder ${res.status}`, data: [] });

    const raw = (await res.json()) as { display_name: string; lat: string; lon: string; type?: string }[];
    const data: Hit[] = raw.map((r) => ({
      name: r.display_name,
      lat: Number(r.lat),
      lon: Number(r.lon),
      kind: r.type,
    })).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon));

    return NextResponse.json({ ok: true, data });
  } catch {
    return NextResponse.json({ ok: false, error: "geocoder unreachable", data: [] });
  }
}
