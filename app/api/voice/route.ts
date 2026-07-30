import { NextResponse } from "next/server";
import { runVoiceTurnDetailed } from "@/core/voice/turn";

export const maxDuration = 60;

/** Web voice turn (live/classic assistant). Cookie-gated by middleware. */
export async function POST(req: Request) {
  const { text, mood } = (await req.json()) as { text?: string; mood?: "formal" | "balanced" | "playful" };
  if (!text?.trim()) return NextResponse.json({ ok: false, error: "Empty" }, { status: 400 });
  const { text: reply, actions } = await runVoiceTurnDetailed(text.trim(), mood ?? "playful");
  return NextResponse.json({ ok: true, data: { text: reply, actions } });
}
