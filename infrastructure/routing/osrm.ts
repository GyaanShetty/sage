import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Directions, from the public OSRM demo server.
 *
 * Free, keyless, no billing — the same stack as the rest of SAGE. It is a
 * demo server though, so it is rate-limited and occasionally slow; every
 * failure here degrades to "no route drawn" rather than an error page,
 * because a missing line on a map is a much smaller problem than a map that
 * refuses to render.
 *
 * ── Why server-side ───────────────────────────────────────────────────────
 *
 * The browser used to call this directly (geo-map.tsx), which sent his live
 * coordinates to a third party from his own IP address, tied to his session.
 * Going through the server means OSRM sees a datacentre, and SAGE decides
 * what leaves the building.
 */

const OSRM = "https://router.project-osrm.org";

export type Profile = "driving" | "walking" | "cycling";

export interface Route {
  /** [lat, lon] pairs, ready for Leaflet. */
  points: [number, number][];
  meters: number;
  seconds: number;
  profile: Profile;
}

export async function routeBetween(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  profile: Profile = "driving",
): Promise<Route | null> {
  const url =
    `${OSRM}/route/v1/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}` +
    `?overview=full&geometries=geojson`;

  try {
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(9_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    const r = j.routes?.[0];
    if (!r) return null;

    return {
      // GeoJSON is [lon, lat]; Leaflet wants [lat, lon]. Getting this backwards
      // produces a route through the ocean, which at least fails visibly.
      points: r.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
      meters: r.distance,
      seconds: r.duration,
      profile,
    };
  } catch {
    return null;
  }
}
