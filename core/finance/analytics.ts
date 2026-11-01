/**
 * The shapes in the spending, computed once on the server.
 *
 * The budget page could already answer "am I over" — this answers the
 * questions that come straight after it: where does it go, is this month
 * unusual, which days are expensive, and who am I actually paying. Every
 * one of those is a different aggregation of the same expense rows, and
 * doing them in the client would mean the page and the API disagreeing
 * about the total the first time one of them changed.
 *
 * Nothing here invents data. A month with no expenses comes back as a
 * month with no expenses, because a chart that quietly interpolates over
 * a gap is lying about a month you did not record.
 */

import { TZ } from "@/lib/config";
import { listExpenses, type Expense } from "./expenses";
import { currentMonth, monthProgress, DEFAULT_BUCKET, type Bucket } from "./budget";

export interface MonthTotal {
  /** "YYYY-MM". */
  month: string;
  total: number;
  /** True for the month still in progress — its bar is not comparable. */
  partial: boolean;
}

export interface CategorySlice {
  category: string;
  spent: number;
  /** Share of the window's total, 0–100. */
  pct: number;
  bucket: Bucket;
}

export interface DayBar {
  day: number;
  spent: number;
  /** Saturday or Sunday in the app timezone. */
  weekend: boolean;
  future: boolean;
}

export interface MerchantRow { merchant: string; spent: number; count: number }

export interface Analytics {
  month: string;
  /** Trailing months, oldest first, including the current partial one. */
  months: MonthTotal[];
  /** This month by category, largest first. */
  categories: CategorySlice[];
  /** Every day of this month. */
  days: DayBar[];
  /** This month's biggest payees. */
  merchants: MerchantRow[];
  /** Committed monthly spend — the part of the month already decided. */
  recurringTotal: number;
  recurring: MerchantRow[];
  /** Median of the complete months, for "is this month unusual". */
  medianMonth: number;
  thisMonthTotal: number;
}

const monthKeyOf = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  /* en-CA gives YYYY-MM-DD, and taking the first seven characters in the
     app timezone is what keeps a 1am purchase in the right month. */
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d).slice(0, 7);
};

const dayOf = (iso: string): number => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, day: "numeric" }).format(d));
};

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
};

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

export async function analyse(month = currentMonth(), monthsBack = 12): Promise<Analytics> {
  /*
   * Fetch once, slice many times.
   *
   * Thirty-one days per month plus a margin, because month lengths vary
   * and the window must reach the first day of the oldest month asked
   * for rather than approximately near it.
   */
  const days = Math.min(800, (monthsBack + 1) * 31 + 5);
  const all: Expense[] = await listExpenses(days);

  const wanted: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) wanted.push(shift(month, -i));

  const byMonth = new Map<string, number>();
  for (const e of all) {
    const k = monthKeyOf(e.date);
    if (!k) continue;
    byMonth.set(k, (byMonth.get(k) ?? 0) + (Number(e.amount) || 0));
  }

  const months: MonthTotal[] = wanted.map((m) => ({
    month: m,
    total: Math.round(byMonth.get(m) ?? 0),
    partial: m === currentMonth(),
  }));

  const inMonth = all.filter((e) => monthKeyOf(e.date) === month);
  const thisMonthTotal = Math.round(inMonth.reduce((a, e) => a + (Number(e.amount) || 0), 0));

  /* Categories, largest first. The order IS the encoding on the donut —
     slices are shaded by rank, so a stable sort matters. */
  const catTotals = new Map<string, number>();
  for (const e of inMonth) {
    const c = e.category || "other";
    catTotals.set(c, (catTotals.get(c) ?? 0) + (Number(e.amount) || 0));
  }
  const categories: CategorySlice[] = [...catTotals]
    .map(([category, spent]) => ({
      category,
      spent: Math.round(spent),
      pct: thisMonthTotal ? (spent / thisMonthTotal) * 100 : 0,
      bucket: (DEFAULT_BUCKET[category] ?? "wants") as Bucket,
    }))
    .sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));

  /* Every day of the month, including the ones with nothing — a gap in a
     daily chart is information. */
  const prog = monthProgress(month);
  const dayTotals = new Array<number>(prog.days + 1).fill(0);
  for (const e of inMonth) {
    const d = dayOf(e.date);
    if (d >= 1 && d <= prog.days) dayTotals[d] += Number(e.amount) || 0;
  }
  const [yy, mm] = month.split("-").map(Number);
  const daysOut: DayBar[] = [];
  for (let d = 1; d <= prog.days; d++) {
    const dow = new Date(yy, mm - 1, d).getDay();
    daysOut.push({
      day: d,
      spent: Math.round(dayTotals[d]),
      weekend: dow === 0 || dow === 6,
      future: d > prog.elapsed,
    });
  }

  const merchTotals = new Map<string, { spent: number; count: number }>();
  for (const e of inMonth) {
    const m = (e.merchant || "unknown").trim();
    const cur = merchTotals.get(m) ?? { spent: 0, count: 0 };
    cur.spent += Number(e.amount) || 0;
    cur.count += 1;
    merchTotals.set(m, cur);
  }
  const merchants: MerchantRow[] = [...merchTotals]
    .map(([merchant, v]) => ({ merchant, spent: Math.round(v.spent), count: v.count }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 8);

  /* Recurring is the part of next month already decided, so it is read
     across the whole window and deduplicated by merchant rather than
     counted once per charge. */
  const recurringBy = new Map<string, { spent: number; count: number }>();
  for (const e of all) {
    if (!e.recurring) continue;
    const m = (e.merchant || "unknown").trim();
    const cur = recurringBy.get(m) ?? { spent: 0, count: 0 };
    /* The latest charge is the current price; older ones are history. */
    cur.spent = Math.max(cur.spent, Number(e.amount) || 0);
    cur.count += 1;
    recurringBy.set(m, cur);
  }
  const recurring: MerchantRow[] = [...recurringBy]
    .map(([merchant, v]) => ({ merchant, spent: Math.round(v.spent), count: v.count }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 10);

  /* The median of COMPLETE months only. Including a month that is four
     days old drags the typical month down and makes every month look
     expensive by comparison. */
  const complete = months.filter((m) => !m.partial && m.total > 0).map((m) => m.total);

  return {
    month,
    months,
    categories,
    days: daysOut,
    merchants,
    recurringTotal: recurring.reduce((a, r) => a + r.spent, 0),
    recurring,
    medianMonth: median(complete),
    thisMonthTotal,
  };
}
