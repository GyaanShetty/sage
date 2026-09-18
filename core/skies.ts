/**
 * Counting what is in the air.
 *
 * Separate from the route because a Next route file may only export handlers
 * and config — and because this is the part that can be silently wrong. The
 * route needs the network; this needs a payload, which a test can supply.
 */

/** Roughly mainland India plus its waters — for the "near you" count. */
const IN = { w: 68, e: 98, s: 6, n: 36 };

/**
 * OpenSky state-vector layout, by index. Positional arrays with no names are
 * exactly the sort of thing that silently shifts under you, so the indices
 * are named once rather than sprinkled through the arithmetic.
 */
const LON = 5, LAT = 6, ALT = 7, GROUND = 8;

/** Above this, a barometric altitude is a bad reading rather than an aircraft. */
const CEILING_SANITY_M = 30_000;

export type State = (number | string | boolean | null)[];
export interface SkyCounts { tracked: number; airborne: number; overIndia: number; ceilingM: number }

const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function countSkies(states: State[]): SkyCounts {
  let airborne = 0;
  let overIndia = 0;
  let ceiling = 0;

  for (const s of states) {
    if (s[GROUND] === false) airborne++;
    const lon = n(s[LON]), lat = n(s[LAT]);
    if (lon !== null && lat !== null && lon > IN.w && lon < IN.e && lat > IN.s && lat < IN.n) overIndia++;
    const alt = n(s[ALT]);
    // One corrupt row must not become the headline figure.
    if (alt !== null && alt > ceiling && alt < CEILING_SANITY_M) ceiling = alt;
  }
  return { tracked: states.length, airborne, overIndia, ceilingM: Math.round(ceiling) };
}
