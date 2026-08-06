import { NextResponse } from "next/server";
import { simulate } from "@/core/simulate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { question } = (await req.json().catch(() => ({}))) as { question?: string };
  if (!question?.trim()) return NextResponse.json({ ok: false, error: "question required" }, { status: 400 });

  const result = await simulate(question);
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, data: result });
}
