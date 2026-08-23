import { NextResponse } from "next/server";
import { runVoiceTurn } from "@/core/voice/turn";
import { machineAuth } from "@/lib/security";

export const maxDuration = 60;

/**
 * Siri / iOS Shortcuts bridge. Lets "Hey Siri, ask SAGE…" reach SAGE's full
 * voice brain from anywhere — no login cookie, authed by CRON_SECRET like the
 * other webhooks.
 *
 * Auth: ?key=CRON_SECRET  (or  Authorization: Bearer CRON_SECRET)
 *
 * Ask (either verb):
 *   GET  /api/webhook/ask?key=…&q=what%20is%20on%20my%20plate%20today
 *   POST /api/webhook/ask?key=…   body { "text": "add milk to my list" }
 *
 * Response: plain text by default (so a Shortcut can pipe it straight into
 * "Speak Text"); pass &format=json for { ok, data: { text } }.
 */
async function handle(req: Request, text: string | null): Promise<Response> {
  const url = new URL(req.url);
  if (!machineAuth(req)) return new NextResponse("unauthorized", { status: 401 });

  const q = (text ?? url.searchParams.get("q") ?? url.searchParams.get("text") ?? "").trim();
  if (!q) return new NextResponse("Ask me something, sir.", { status: 400 });

  const wantsJson = url.searchParams.get("format") === "json";
  try {
    const reply = await runVoiceTurn(q);
    if (wantsJson) return NextResponse.json({ ok: true, data: { text: reply } });
    return new NextResponse(reply, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch {
    const msg = "Something went wrong on my end, sir.";
    if (wantsJson) return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    return new NextResponse(msg, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

export async function GET(req: Request) {
  return handle(req, null);
}

export async function POST(req: Request) {
  let text: string | null = null;
  try {
    const body = (await req.json()) as { text?: string; q?: string };
    text = body.text ?? body.q ?? null;
  } catch {
    // no/invalid body → fall back to query params in handle()
  }
  return handle(req, text);
}
