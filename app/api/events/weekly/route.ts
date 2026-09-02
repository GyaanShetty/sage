import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";

/**
 * Events per ISO week for the last twelve weeks, optionally of one type.
 *
 * Weeks are bucketed by their Monday, derived in IST like every other day key
 * in SAGE. Deriving it from `toISOString()` would push everything logged after
 * 18:30 into the following day and, on a Sunday evening, into the following
 * week — an off-by-one that only shows up on Sunday nights, which is the worst
 * kind to find later.
 */
export const dynamic = "force-dynamic";

const WEEKS = 12;

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/** The Monday of the IST week containing `d`, as a YYYY-MM-DD key. */
function weekKey(d: Date): string {
  const k = dayKey(d);
  const noon = new Date(`${k}T12:00:00Z`);
  const back = (noon.getUTCDay() + 6) % 7;      // Monday = 0
  noon.setUTCDate(noon.getUTCDate() - back);
  return noon.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const type = new URL(req.url).searchParams.get("type");
  const since = new Date(Date.now() - WEEKS * 7 * 86400000);

  let q = db
    .from("Event")
    .select("createdAt")
    .eq("userId", DEFAULT_USER_ID)
    .gte("createdAt", since.toISOString())
    .limit(5000);
  if (type) q = q.eq("type", type);

  const { data } = await q;

  // Seed every week, so a quiet stretch is a flat bar rather than a missing
  // column — the gap is the information.
  const counts = new Map<string, number>();
  for (let i = WEEKS - 1; i >= 0; i--) counts.set(weekKey(new Date(Date.now() - i * 7 * 86400000)), 0);
  for (const row of data ?? []) {
    const k = weekKey(new Date(row.createdAt as string));
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return NextResponse.json({
    ok: true,
    data: [...counts.entries()].map(([week, count]) => ({ week, count })),
  });
}
