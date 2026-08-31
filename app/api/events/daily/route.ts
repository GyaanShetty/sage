import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";

/**
 * Events per day for the last week, counted in IST.
 *
 * The day key comes from Intl in the configured zone, never from
 * `toISOString().slice(0, 10)` — that is UTC, and at +05:30 everything logged
 * after 18:30 lands on the following day's bar. A histogram that is wrong by
 * one column every evening is worse than no histogram, because it looks fine.
 */
export const dynamic = "force-dynamic";

const DAYS = 7;
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

export async function GET() {
  const since = new Date(Date.now() - DAYS * 86400000);

  const { data } = await db
    .from("Event")
    .select("createdAt")
    .eq("userId", DEFAULT_USER_ID)
    .gte("createdAt", since.toISOString())
    .limit(2000);

  const counts = new Map<string, number>();
  // Seed every day first, so a quiet day is a zero-height bar rather than a
  // missing column — the gap is the information.
  for (let i = DAYS - 1; i >= 0; i--) counts.set(dayKey(new Date(Date.now() - i * 86400000)), 0);
  for (const row of data ?? []) {
    const k = dayKey(new Date(row.createdAt as string));
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return NextResponse.json({
    ok: true,
    data: [...counts.entries()].map(([day, count]) => ({ day, count })),
  });
}
