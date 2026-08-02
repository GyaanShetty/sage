import { NextResponse } from "next/server";
import { drainPhoneActions } from "@/core/phone/queue";

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
function authorised(req: Request): boolean {
  const secret = process.env.SAGE_PHONE_TOKEN ?? process.env.CRON_SECRET;
  if (!secret) return false; // no token configured → endpoint stays shut
  const url = new URL(req.url);
  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("token") ??
    "";
  // Length-independent compare is not worth it here: the token is high-entropy
  // and this is a single-user endpoint, but constant-time costs nothing.
  if (supplied.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= supplied.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
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
