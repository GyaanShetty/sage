import { NextResponse } from "next/server";
import { routeBetween, type Profile } from "@/infrastructure/routing/osrm";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Directions between two points. See infrastructure/routing/osrm for why
 *  this is server-side rather than called from the browser. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const num = (k: string) => {
    const v = Number(q.get(k));
    return Number.isFinite(v) ? v : null;
  };
  const fromLat = num("fromLat"), fromLon = num("fromLon");
  const toLat = num("toLat"), toLon = num("toLon");
  if (fromLat === null || fromLon === null || toLat === null || toLon === null) {
    return NextResponse.json({ ok: false, error: "fromLat, fromLon, toLat, toLon required" }, { status: 400 });
  }

  const profile = (q.get("profile") ?? "driving") as Profile;
  const allowed: Profile[] = ["driving", "walking", "cycling"];
  const route = await routeBetween(
    { lat: fromLat, lon: fromLon },
    { lat: toLat, lon: toLon },
    allowed.includes(profile) ? profile : "driving",
  );

  if (!route) return NextResponse.json({ ok: false, error: "No route available right now." }, { status: 502 });
  return NextResponse.json({ ok: true, data: route });
}
