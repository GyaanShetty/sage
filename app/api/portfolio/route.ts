import { NextResponse } from "next/server";
import { getPositions, upsertHolding, deleteHolding, type Holding } from "@/core/portfolio/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";
  const data = await getPositions(origin, cookie);
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<Holding> & { id?: string };
  const id = await upsertHolding(body);
  return NextResponse.json({ ok: true, data: { id } });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteHolding(id);
  return NextResponse.json({ ok: true });
}
