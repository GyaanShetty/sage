// Static geo datasets for the intelligence atlas. All approximate, curated,
// and clearly labelled as indicative in the UI.

export type LL = [number, number]; // [lat, lon]

/** Major maritime trade lanes (great-circle-ish waypoints). */
export const TRADE_ROUTES: { name: string; path: LL[] }[] = [
  { name: "Asia–Europe (Suez)", path: [[31.2, 121.5], [1.3, 103.8], [6.9, 79.8], [12.8, 43.3], [30.0, 32.5], [36.8, 3.0], [51.9, 4.5]] },
  { name: "Trans-Pacific", path: [[31.2, 121.5], [35.4, 139.7], [37.8, -122.4], [33.7, -118.2]] },
  { name: "Trans-Atlantic", path: [[51.9, 4.5], [40.7, -74.0]] },
  { name: "Cape Route", path: [[1.3, 103.8], [-6.2, 106.8], [-33.9, 18.4], [6.4, 3.4], [36.8, -6.3], [51.9, 4.5]] },
  { name: "Panama Link", path: [[33.7, -118.2], [9.0, -79.5], [25.8, -80.2]] },
  { name: "Gulf–Asia (Hormuz)", path: [[26.6, 56.3], [25.3, 55.3], [19.1, 72.9], [1.3, 103.8]] },
];

/** Busiest air corridors (endpoints; drawn as great-circle arcs). */
export const AIR_CORRIDORS: { name: string; from: LL; to: LL }[] = [
  { name: "LHR–JFK", from: [51.47, -0.45], to: [40.64, -73.78] },
  { name: "DXB–LHR", from: [25.25, 55.36], to: [51.47, -0.45] },
  { name: "DEL–DXB", from: [28.56, 77.1], to: [25.25, 55.36] },
  { name: "BLR–SIN", from: [13.2, 77.7], to: [1.36, 103.99] },
  { name: "LAX–NRT", from: [33.94, -118.4], to: [35.76, 140.39] },
  { name: "HKG–LHR", from: [22.31, 113.91], to: [51.47, -0.45] },
  { name: "SIN–SYD", from: [1.36, 103.99], to: [-33.95, 151.18] },
  { name: "BOM–DXB", from: [19.09, 72.87], to: [25.25, 55.36] },
];

/** Active conflict / high-tension zones — indicative, neutrally named. */
export const CONFLICT_ZONES: { name: string; at: LL; intensity: number }[] = [
  { name: "Eastern Europe", at: [48.4, 35.0], intensity: 3 },
  { name: "Gaza / Levant", at: [31.5, 34.5], intensity: 3 },
  { name: "Sudan", at: [15.5, 32.5], intensity: 3 },
  { name: "Sahel", at: [15.0, 0.0], intensity: 2 },
  { name: "Myanmar", at: [21.0, 96.0], intensity: 2 },
  { name: "DR Congo (East)", at: [-1.7, 29.2], intensity: 2 },
  { name: "Red Sea shipping", at: [15.0, 42.0], intensity: 2 },
  { name: "Sahel–Nigeria", at: [11.0, 8.0], intensity: 1 },
];

/** Satellite groups fetched from Celestrak (via /api/atlas/tle). */
export const SAT_GROUPS = ["stations", "visual"] as const;

/** Great-circle interpolation for smooth arcs. */
export function greatCircle(from: LL, to: LL, segments = 48): LL[] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const [lat1, lon1] = [toRad(from[0]), toRad(from[1])];
  const [lat2, lon2] = [toRad(to[0]), toRad(to[1])];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (d === 0) return [from, to];
  const out: LL[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return out;
}
