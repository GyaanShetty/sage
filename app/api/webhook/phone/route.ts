import { NextResponse } from "next/server";
import { drainPhoneActions } from "@/core/phone/queue";
import { machineAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The phone's endpoint. Lives under /api/webhook so the session gate lets it
 * through — a Shortcut has no cookie — and is guarded by its own token instead.
 *
 * GET  → claim and return everything pending (the Shortcut then performs each)
 * GET ?peek=1 → look without claiming, for debugging
 *
 * Returns a flat, boring shape on purpose: Shortcuts' JSON handling is awkward,
 * and every nested object is another "Get Dictionary Value" the user has to
 * wire up by hand.
 */
export async function GET(req: Request) {
  if (!machineAuth(req, process.env.SAGE_PHONE_TOKEN ?? process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  const peek = new URL(req.url).searchParams.get("peek") === "1";
  const actions = await drainPhoneActions(peek);
  return NextResponse.json({
    ok: true,
    count: actions.length,
    actions: actions.map((a) => ({
      id: a.id,
      kind: a.kind,
      text: a.text,
      at: a.at ?? "",
      detail: a.detail ?? "",
    })),
  });
}
