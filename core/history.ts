import { TZ } from "@/lib/config";

/**
 * A pane's own past, as a dense daily series.
 *
 * Half the wall reads as empty because a pane holding one number that happens
 * to be zero today looks identical to a pane that has never worked. History
 * separates them: "no spend today" and "no spend ever recorded" are different
 * facts, and a series shows which one you are looking at.
 *
 * Dense and zero-filled on purpose. A sparse series — only the days something
 * happened — draws a chart where the x-axis is not time, so a gap of a
 * fortnight looks the same width as an overnight one and every trend it
 * suggests is a lie.
 *
 * The pure half is above the db import so it can be tested without one.
 */

/** IST day key, `YYYY-MM-DD`. */
export function dayKey(d: Date | string | number, tz = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(d));
}

export interface Point { day: string; value: number }

/**
 * Every day from `days` ago to today, in order, with zero where nothing
 * happened.
 *
 * Days are stepped by *key*, not by subtracting 86,400,000 from a timestamp.
 * A day is not always 24 hours — India does not observe DST, but the helper
 * is not India-only and an hour of drift silently drops or doubles a day at
 * the boundary, which shows up as a chart that is one column short a fortnight
 * later.
 */
export function densify(
  rows: { at: string | number | Date; value?: number }[],
  days: number,
  tz = TZ,
): Point[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const k = dayKey(r.at, tz);
    totals.set(k, (totals.get(k) ?? 0) + (r.value ?? 1));
  }

  const out: Point[] = [];

  /*
   * Anchored to today's *local* day, not to the UTC one.
   *
   * `new Date()` at 00:12 IST is still the previous day in UTC, so starting
   * from the UTC date ended the series a day short — the chart quietly stopped
   * at yesterday for the five and a half hours after midnight, every night.
   * Reading the local key first and parsing it back at midday makes the anchor
   * the day he is actually in.
   */
  const cursor = new Date(`${dayKey(new Date(), tz)}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - (days - 1));

  for (let i = 0; i < days; i++) {
    const k = dayKey(cursor, tz);
    out.push({ day: k, value: totals.get(k) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Just the numbers, for the instruments, which take `number[]`. */
export const values = (points: Point[]): number[] => points.map((p) => p.value);

/**
 * Totals per weekday, Monday first — the shape a radial plot wants.
 *
 * Monday first rather than Sunday because the week he lives in starts on a
 * Monday, and a chart whose first spoke is a weekend reads wrong however
 * correct the numbers are.
 */
export function byWeekday(points: Point[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    // `p.day` is already a local day key, so it is read back at midday UTC and
    // its weekday taken directly — converting a zone twice is how a Monday
    // becomes a Sunday.
    const dow = new Date(`${p.day}T12:00:00Z`).getUTCDay();
    out[(dow + 6) % 7] += p.value;   // Monday first
  }
  return out;
}

/* ── the store ──────────────────────────────────────────────────────────── */

import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Daily counts of an Event type over the last `days`.
 *
 * `field` optionally sums a number out of the payload instead of counting
 * rows — spend wants the amount, agent runs want the count.
 */
export async function seriesFor(
  type: string,
  days = 30,
  field?: string,
): Promise<Point[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const { data } = await db
    .from("Event")
    .select("createdAt, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", type)
    .gte("createdAt", since.toISOString())
    .order("createdAt", { ascending: true })
    .limit(2000);

  const rows = (data ?? []).map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const raw = field ? p[field] : undefined;
    const n = typeof raw === "number" ? raw : Number(raw);
    return { at: r.createdAt as string, value: field ? (Number.isFinite(n) ? n : 0) : 1 };
  });

  return densify(rows, days);
}
