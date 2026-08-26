import { NextResponse } from "next/server";
import { deletePlace, listPlaces, savePlace, updatePlace } from "@/core/places";

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

/** Change a place — its name, kind or schedule — without minting a new id. */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { id?: string; name?: string; kind?: string; schedule?: { fromMin: number; toMin: number; days: number[] } }
    | null;
  if (!body?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const updated = await updatePlace(body.id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(body.schedule !== undefined ? { schedule: body.schedule } : {}),
  });
  if (!updated) return NextResponse.json({ ok: false, error: "No such place." }, { status: 404 });
  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  return NextResponse.json({ ok: await deletePlace(id) });
}
