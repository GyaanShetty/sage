import { NextResponse } from "next/server";
import { runVoiceTurn } from "@/core/voice/turn";

export const maxDuration = 60;

/** Web voice turn (live/classic assistant). Cookie-gated by middleware. */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ ok: false, error: "Empty" }, { status: 400 });
  const reply = await runVoiceTurn(text.trim());
  return NextResponse.json({ ok: true, data: { text: reply } });
}
