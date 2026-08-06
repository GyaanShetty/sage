import { NextResponse } from "next/server";
import { scoreShadow, addShadow, closeShadow, deleteShadow, type Side } from "@/core/portfolio/shadow";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return NextResponse.json({ ok: true, data: await scoreShadow() });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as
    { symbol?: string; side?: Side; price?: number; size?: number; thesis?: string; whyNot?: string; id?: string; closePrice?: number };

  if (b.id && b.closePrice !== undefined) {
    await closeShadow(b.id, Number(b.closePrice) || 0);
    return NextResponse.json({ ok: true, data: await scoreShadow() });
  }

  if (!b.symbol?.trim() || !b.price || !b.size) {
    return NextResponse.json({ ok: false, error: "symbol, price and size required" }, { status: 400 });
  }

  await addShadow({
    symbol: b.symbol, side: b.side === "short" ? "short" : "buy",
    price: Number(b.price), size: Number(b.size),
    thesis: b.thesis ?? "", whyNot: b.whyNot ?? "",
  });
  return NextResponse.json({ ok: true, data: await scoreShadow() });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteShadow(id);
  return NextResponse.json({ ok: true, data: await scoreShadow() });
}
