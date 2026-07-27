import { NextResponse } from "next/server";
import { dueCards, gradeCard, allCardsCount, generateDailyCards } from "@/core/retention/cards";

export const dynamic = "force-dynamic";

export async function GET() {
  const [cards, total] = await Promise.all([dueCards(30), allCardsCount()]);
  return NextResponse.json({ ok: true, data: { cards, total } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string; grade?: number };
  if (body.action === "generate") {
    const n = await generateDailyCards().catch(() => 0);
    return NextResponse.json({ ok: true, data: { generated: n } });
  }
  if (body.id && typeof body.grade === "number") {
    await gradeCard(body.id, body.grade);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
}
