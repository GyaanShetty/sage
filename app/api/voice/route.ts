import { NextResponse } from "next/server";
import { runVoiceTurnDetailed } from "@/core/voice/turn";

export const maxDuration = 60;

/** Web voice turn (live/classic assistant). Cookie-gated by middleware. */
export async function POST(req: Request) {
  const { text, mood } = (await req.json().catch(() => ({}))) as {
    text?: string;
    mood?: "formal" | "balanced" | "playful";
  };
  if (!text?.trim()) return NextResponse.json({ ok: false, error: "Empty" }, { status: 400 });

  try {
    const { text: reply, actions } = await runVoiceTurnDetailed(text.trim(), mood ?? "playful");
    return NextResponse.json({ ok: true, data: { text: reply, actions } });
  } catch (err) {
    // An unhandled throw here returned Next's HTML error page, which made the
    // caller's res.json() throw in turn — so every model failure surfaced as
    // "Link error, try again", a network message for a problem that was never
    // the network. Always answer with JSON, and say what actually happened.
    const msg = err instanceof Error ? err.message : String(err);
    const quota = /quota|rate.?limit|429|exhaust/i.test(msg);
    return NextResponse.json(
      {
        ok: false,
        error: quota
          ? "Every Gemini key is rate-limited right now — give it a few minutes."
          : `SAGE couldn't answer that: ${msg.slice(0, 200)}`,
      },
      { status: quota ? 429 : 500 },
    );
  }
}
