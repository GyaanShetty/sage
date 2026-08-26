import { TZ } from "@/lib/config";

/**
 * Places, and when he is meant to be at them.
 *
 * Deliberately free of any database import. core/places/index.ts talks to
 * Supabase, which drags node:assert and friends into anything that imports
 * it — and the map is a client component. Splitting the pure half out lets
 * the browser use the same types and the same scheduling rule as the server,
 * rather than a second copy that can drift.
 */

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Free-text kind — gym, home, work. Used for the marker glyph. */
  kind?: string;
  /**
   * When he is normally there, in the app timezone. Local minutes past
   * midnight, plus the weekdays it applies to (0 = Sunday).
   */
  schedule?: { fromMin: number; toMin: number; days: number[] };
  at: string;
}

/** Metres between two points. Haversine — good to a metre at city scale. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Close enough to count as "there". Generous, because a GPS fix indoors is. */
export const AT_PLACE_M = 150;

/**
 * Somewhere he is due to be, and is not.
 *
 * Returns the place whose window is open now while he is elsewhere — the one
 * case worth drawing a route for unprompted. Being *at* the gym during gym
 * hours needs no directions.
 */
export function dueAt(
  places: Place[],
  now: Date,
  here: { lat: number; lon: number } | null,
): Place | null {
  /**
   * Both fields read from the same timezone, in one call.
   *
   * The obvious version — tzHour(now) * 60 + now.getMinutes() — mixes the
   * app's hour with the *server's* minutes, which is fine everywhere with a
   * whole-hour offset and wrong in exactly the place this app runs: IST is
   * UTC+5:30, so the minutes differ too. getDay() has the same problem a day
   * at a time.
   */
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));

  for (const p of places) {
    if (!p.schedule) continue;
    if (p.schedule.days.length && !p.schedule.days.includes(day)) continue;
    if (minutes < p.schedule.fromMin || minutes > p.schedule.toMin) continue;
    if (here && distanceM(here, p) <= AT_PLACE_M) continue; // already there
    return p;
  }
  return null;
}
