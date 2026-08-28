import { NextResponse } from "next/server";
import { getWeather } from "@/infrastructure/weather";

/**
 * Weather at a point — for the map, as its centre moves.
 *
 * Without coordinates this is the env location, which is what the dashboard
 * wants. With them it is wherever he is looking, labelled honestly: a caller
 * that supplies a point but no name gets "MAP CENTRE" rather than the stale
 * home label, because reporting one place's weather under another's name is a
 * wrong answer wearing a right one's clothes.
 *
 * Cached for five minutes. Weather does not move faster than that, and the
 * map would otherwise refetch on every pan frame.
 */
export const revalidate = 300;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  const here = Number.isFinite(lat) && Number.isFinite(lon);

  if (here && (Math.abs(lat) > 90 || Math.abs(lon) > 180)) {
    return NextResponse.json({ ok: false, error: "coordinates out of range" }, { status: 400 });
  }

  const data = await getWeather(
    here ? { lat, lon, place: q.get("place") ?? undefined } : undefined,
  );
  return NextResponse.json({ ok: !!data, data });
}
