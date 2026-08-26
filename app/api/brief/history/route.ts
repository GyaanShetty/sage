import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { endOfTodayUtc, startOfTodayUtc } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Past briefings, newest first.
 *
 * The debrief generator already writes every script it produces as a
 * `debrief.generated` event, but nothing ever read them back — a briefing you
 * missed was gone. This exposes them so any of the last fortnight can be
 * re-read or replayed on demand.
 *
 * ── ?day=today ────────────────────────────────────────────────────────────
 *
 * The dashboard panel took the newest row and called it "today's", which is
 * true right up until the moment it isn't: before the morning brief has been
 * generated, the newest row is *yesterday's*, and it rendered with no date on
 * it. That is how Wednesday came to show Tuesday's briefing.
 *
 * The caller now says which it wants. Filtering here rather than in the
 * component means "there is no brief yet today" is a real, answerable state
 * instead of something the UI has to infer from a timestamp.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(30, Number(url.searchParams.get("limit") ?? 14) || 14);
  const todayOnly = url.searchParams.get("day") === "today";

  let q = db
    .from("Event")
    .select("id, createdAt, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "debrief.generated");

  if (todayOnly) {
    // The owner's day, not the server's — this is the fourth bug in this
    // codebase caused by doing that maths by hand instead of asking here.
    q = q.gte("createdAt", startOfTodayUtc()).lte("createdAt", endOfTodayUtc());
  }

  const { data, error } = await q.order("createdAt", { ascending: false }).limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const items = (data ?? [])
    .map((row) => {
      const p = row.payload as { bucket?: string; text?: string } | null;
      return p?.text
        ? { id: row.id, createdAt: row.createdAt, bucket: p.bucket ?? null, text: p.text }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ ok: true, data: items });
}
