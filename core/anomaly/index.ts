import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { tzDay } from "@/lib/config";

/**
 * Noticing that something is off.
 *
 * Every alert in SAGE so far is a threshold someone chose: over budget, under
 * the step goal, past a due date. Thresholds catch the things you already knew
 * to worry about. What they cannot catch is a change in your own pattern —
 * spending twice your usual on a category still inside its limit, sleep
 * drifting an hour later each week, a stock moving unremarkably in absolute
 * terms but wildly for that stock.
 *
 * So this compares you against you. A baseline from your own history, and a
 * flag when today departs from it by more than chance comfortably explains.
 *
 * Statistics, not a model. An LLM asked "is this unusual?" will always find
 * something, because that is what it was asked for; arithmetic says no when
 * the answer is no, which is the property that makes an alert worth reading.
 */

export interface Anomaly {
  key: string;
  /** What moved. */
  subject: string;
  /** Said plainly, with the numbers in it. */
  detail: string;
  /** How far out, in standard deviations. Signed: negative is a drop. */
  z: number;
  /** Sample size the baseline rests on. */
  n: number;
  direction: "up" | "down";
  href?: string;
}

export interface Baseline { mean: number; sd: number; n: number }

/** Mean and standard deviation, ignoring nothing and inventing nothing. */
export function baseline(values: number[]): Baseline {
  const n = values.length;
  if (n === 0) return { mean: 0, sd: 0, n: 0 };
  const mean = values.reduce((a, v) => a + v, 0) / n;
  // Sample standard deviation: with n-1 the estimate is unbiased, and with a
  // dozen days of data that difference is not academic.
  const variance = n > 1 ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, sd: Math.sqrt(variance), n };
}

/**
 * How unusual a value is, in standard deviations.
 *
 * Returns null when the baseline cannot support the claim — too few points, or
 * a series so flat that any deviation divides by ~zero and reports infinity.
 * Both cases used to be where naive anomaly detection produces its most
 * confident nonsense.
 */
export function zScore(value: number, b: Baseline, { minN = 7, minSd = 1e-9 } = {}): number | null {
  if (b.n < minN) return null;
  if (b.sd <= minSd) {
    // A perfectly flat history is real information: any change at all is a
    // departure, but it is not a *statistical* one, so it needs its own floor
    // rather than an invented z of a million.
    return value === b.mean ? 0 : null;
  }
  return (value - b.mean) / b.sd;
}

/** Beyond this counts as worth mentioning. Two sigma is roughly a 1-in-20 day. */
const THRESHOLD = 2;

function flag(
  key: string,
  subject: string,
  value: number,
  b: Baseline,
  render: (value: number, mean: number, z: number) => string,
  href?: string,
): Anomaly | null {
  const z = zScore(value, b);
  if (z === null || Math.abs(z) < THRESHOLD) return null;
  return {
    key, subject,
    detail: render(value, b.mean, z),
    z: Number(z.toFixed(2)),
    n: b.n,
    direction: z >= 0 ? "up" : "down",
    href,
  };
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * Spending, per category, against that category's own history.
 *
 * Per category rather than in total, because the total is dominated by rent
 * and hides everything interesting. Whole days are compared — a partial today
 * would look like a collapse in spending every single morning.
 */
async function spendingAnomalies(): Promise<Anomaly[]> {
  const { listExpenses } = await import("@/core/finance/expenses");
  const expenses = await listExpenses(90);
  if (expenses.length < 20) return [];

  const today = tzDay();
  const byCategoryDay = new Map<string, Map<string, number>>();
  for (const e of expenses) {
    const day = tzDay(e.date);
    if (!byCategoryDay.has(e.category)) byCategoryDay.set(e.category, new Map());
    const days = byCategoryDay.get(e.category)!;
    days.set(day, (days.get(day) ?? 0) + e.amount);
  }

  const out: Anomaly[] = [];
  for (const [category, days] of byCategoryDay) {
    const history = [...days.entries()].filter(([d]) => d !== today).map(([, v]) => v);
    const todaySpend = days.get(today);
    if (todaySpend == null) continue;

    const hit = flag(
      `spend:${category}`,
      category,
      todaySpend,
      baseline(history),
      (v, mean) => `${inr(v)} on ${category} today, against a usual ${inr(mean)}.`,
      "/portfolio",
    );
    // Only overspending is interesting. A quiet day is not an anomaly worth
    // waking someone for.
    if (hit && hit.direction === "up") out.push(hit);
  }
  return out;
}

/** Sleep and steps, against the last few weeks of the same. */
async function healthAnomalies(): Promise<Anomaly[]> {
  const { listDays } = await import("@/core/health/store");
  const days = await listDays(45);
  const today = tzDay();
  const out: Anomaly[] = [];

  const sleepHistory = days.filter((d) => d.day !== today && d.sleepHours != null).map((d) => d.sleepHours as number);
  const sleptLast = days.filter((d) => d.sleepHours != null).at(-1);
  if (sleptLast?.sleepHours != null) {
    const hit = flag(
      "sleep", "Sleep", sleptLast.sleepHours, baseline(sleepHistory),
      (v, mean) => `${v.toFixed(1)}h last night, against a usual ${mean.toFixed(1)}h.`,
      "/health",
    );
    if (hit && hit.direction === "down") out.push(hit);
  }

  const stepHistory = days.filter((d) => d.day !== today && d.steps != null).map((d) => d.steps as number);
  const stepsToday = days.find((d) => d.day === today)?.steps;
  if (stepsToday != null) {
    const hit = flag(
      "steps", "Steps", stepsToday, baseline(stepHistory),
      (v, mean) => `${Math.round(v).toLocaleString()} steps, against a usual ${Math.round(mean).toLocaleString()}.`,
      "/health",
    );
    // Both directions here: an unusually big day is worth knowing too.
    if (hit) out.push(hit);
  }

  return out;
}

/** Study minutes per day, against his own rhythm. */
async function studyAnomalies(): Promise<Anomaly[]> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", "education.log")
    .order("createdAt", { ascending: false }).limit(400);

  const byDay = new Map<string, number>();
  for (const row of data ?? []) {
    const p = row.payload as { kind?: string; minutes?: number; at?: string };
    if (p?.kind !== "session" || !p.at || !p.minutes) continue;
    const day = tzDay(p.at);
    byDay.set(day, (byDay.get(day) ?? 0) + p.minutes);
  }

  const today = tzDay();
  const history = [...byDay.entries()].filter(([d]) => d !== today).map(([, v]) => v);
  const todayMinutes = byDay.get(today);
  if (todayMinutes == null) return [];

  const hit = flag(
    "study", "Study", todayMinutes, baseline(history),
    (v, mean) => `${Math.round(v)} minutes today, against a usual ${Math.round(mean)}.`,
    "/education",
  );
  return hit ? [hit] : [];
}

/**
 * A market move that is large *for that instrument*.
 *
 * Bitcoin moving 4% is a Tuesday; a large-cap moving 4% is news. Absolute
 * thresholds cannot express that, which is why the existing price alerts —
 * which are rules he sets himself — do not make this redundant.
 */
async function marketAnomalies(): Promise<Anomaly[]> {
  const { getMarkets } = await import("@/infrastructure/markets");
  const coins = await getMarkets().catch(() => null);
  if (!coins?.length) return [];

  const out: Anomaly[] = [];
  for (const c of coins) {
    // The sparkline is the instrument's own recent behaviour — its daily
    // returns are the only honest baseline available without a price history
    // table.
    const prices = c.spark ?? [];
    if (prices.length < 10) continue;

    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) returns.push(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100);
    }

    const hit = flag(
      `market:${c.symbol}`, c.symbol, c.change24h, baseline(returns),
      (v) => `${c.symbol} ${v >= 0 ? "up" : "down"} ${Math.abs(v).toFixed(1)}% — large for how it has been moving.`,
      "/markets",
    );
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Everything that looks off right now, most unusual first.
 *
 * Capped, because an anomaly list long enough to scroll is a list nobody
 * reads — and if six things are unusual at once, the two most unusual are the
 * ones that matter.
 */
export async function detectAnomalies(limit = 4): Promise<Anomaly[]> {
  const groups = await Promise.all([
    spendingAnomalies().catch(() => []),
    healthAnomalies().catch(() => []),
    studyAnomalies().catch(() => []),
    marketAnomalies().catch(() => []),
  ]);

  return groups
    .flat()
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, limit);
}
