import { NextResponse } from "next/server";
import { deletePlace, listPlaces, savePlace } from "@/core/places";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, data: await listPlaces().catch(() => []) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { name?: string; lat?: number; lon?: number; kind?: string; schedule?: { fromMin: number; toMin: number; days: number[] } }
    | null;
  if (!body?.name || typeof body.lat !== "number" || typeof body.lon !== "number") {
    return NextResponse.json({ ok: false, error: "name, lat and lon are required" }, { status: 400 });
  }
  const place = await savePlace({ name: body.name, lat: body.lat, lon: body.lon, kind: body.kind, schedule: body.schedule });
  if (!place) return NextResponse.json({ ok: false, error: "Those coordinates aren't on Earth." }, { status: 400 });
  return NextResponse.json({ ok: true, data: place });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  return NextResponse.json({ ok: await deletePlace(id) });
}
