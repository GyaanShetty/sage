import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";
import { CATEGORIES, type Category, type Expense } from "./expenses";

/**
 * Budgeting.
 *
 * The expense list already said where the money went. A budget is the other
 * half: what you meant it to do. The two only become useful together, so
 * everything here is computed against the real expenses rather than kept as a
 * separate set of numbers you have to reconcile by hand.
 *
 * 50/30/20 is offered as a starting point, not a law — it generates a plan you
 * can then edit line by line, because a rule of thumb invented for American
 * middle-class salaries is a reasonable first guess and nothing more.
 */

const TYPE = "finance.budget";

/** The three buckets of the classic rule. Every line belongs to exactly one. */
export const BUCKETS = ["needs", "wants", "savings"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_META: Record<Bucket, { label: string; hint: string }> = {
  needs: { label: "Needs", hint: "Rent, food, bills, transport — the things you cannot skip" },
  wants: { label: "Wants", hint: "Eating out, entertainment, shopping — the discretionary half" },
  savings: { label: "Savings & debt", hint: "Investments, repayments, anything you keep" },
};

/** Where each expense category lands by default. Overridable per line. */
export const DEFAULT_BUCKET: Record<Category, Bucket> = {
  food: "needs",
  transport: "needs",
  bills: "needs",
  health: "needs",
  shopping: "wants",
  entertainment: "wants",
  subscriptions: "wants",
  other: "wants",
};

export interface BudgetLine {
  id: string;
  /** An expense category, or any label you invent. */
  category: string;
  bucket: Bucket;
  /** Monthly cap, in ₹. */
  limit: number;
}

export interface BudgetPlan {
  /** "YYYY-MM" in the app timezone. */
  month: string;
  income: number;
  /** Just a label for how the plan was seeded; edits do not invalidate it. */
  basis: "50-30-20" | "custom";
  lines: BudgetLine[];
  updatedAt: string;
}

/** Month key in the app timezone — a budget belongs to a calendar month. */
export function currentMonth(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" })
    .format(d)
    .slice(0, 7);
}

/** Days in a month, and how many have elapsed — the basis for pacing. */
export function monthProgress(month: string, now = new Date()): { days: number; elapsed: number } {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();          // day 0 of next month = last of this
  const today = currentMonth(now) === month
    ? Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, day: "numeric" }).format(now))
    : days;                                           // a past month is fully elapsed
  return { days, elapsed: Math.min(days, Math.max(1, today)) };
}

/**
 * Seed a plan from a percentage split.
 *
 * The split is applied to the buckets, then divided across the categories that
 * belong to each — evenly, because guessing a household's rent-to-food ratio
 * would be inventing detail. It is a scaffold to edit, and the UI says so.
 */
export function applyRule(income: number, split: Record<Bucket, number> = { needs: 50, wants: 30, savings: 20 }): BudgetLine[] {
  const lines: BudgetLine[] = [];

  for (const bucket of BUCKETS) {
    const pot = (income * (split[bucket] ?? 0)) / 100;
    const cats = CATEGORIES.filter((c) => DEFAULT_BUCKET[c] === bucket);

    if (cats.length === 0) {
      // Savings has no expense category of its own — it is what does not get
      // spent — so it gets a single line rather than vanishing from the plan.
      lines.push({ id: crypto.randomUUID(), category: BUCKET_META[bucket].label, bucket, limit: Math.round(pot) });
      continue;
    }
    for (const c of cats) {
      lines.push({ id: crypto.randomUUID(), category: c, bucket, limit: Math.round(pot / cats.length) });
    }
  }
  return lines;
}

// ── Storage ─────────────────────────────────────────────────────────────────

export async function getPlan(month = currentMonth()): Promise<BudgetPlan | null> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>month", month)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.payload as BudgetPlan) ?? null;
}

export async function savePlan(plan: Omit<BudgetPlan, "updatedAt">): Promise<BudgetPlan> {
  const next: BudgetPlan = { ...plan, updatedAt: new Date().toISOString() };

  const { data: existing } = await db
    .from("Event")
    .select("id")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>month", plan.month)
    .limit(1)
    .maybeSingle();

  if (existing) await db.from("Event").update({ payload: next }).eq("id", existing.id);
  else await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE, payload: next });

  return next;
}

/** Carry last month's plan forward — most months look like the one before. */
export async function copyPlan(from: string, to: string): Promise<BudgetPlan | null> {
  const prev = await getPlan(from);
  if (!prev) return null;
  return savePlan({
    month: to,
    income: prev.income,
    basis: prev.basis,
    // Fresh ids: two months sharing a line id would make editing one edit both.
    lines: prev.lines.map((l) => ({ ...l, id: crypto.randomUUID() })),
  });
}

// ── The part that matters: plan versus reality ───────────────────────────────

export interface LineStatus extends BudgetLine {
  spent: number;
  remaining: number;
  /** Share of the limit used, in %. Can exceed 100. */
  usedPct: number;
  /** Spend at the current daily rate, extrapolated to month end. */
  projected: number;
  state: "under" | "watch" | "over";
}

export interface BucketStatus {
  bucket: Bucket;
  limit: number;
  spent: number;
  targetPct: number;
  actualPct: number;
}

export interface BudgetStatus {
  month: string;
  income: number;
  days: number;
  elapsed: number;
  lines: LineStatus[];
  buckets: BucketStatus[];
  totalBudget: number;
  totalSpent: number;
  /** Spend not covered by any line — the money the plan does not know about. */
  unbudgeted: { category: string; spent: number }[];
  unbudgetedTotal: number;
  projectedTotal: number;
  /** Income minus everything spent, so far. */
  leftToSpend: number;
  notes: string[];
}

/** Expenses that fall inside a given month, by the app timezone. */
export function expensesInMonth(expenses: Expense[], month: string): Expense[] {
  return expenses.filter((e) => {
    const d = new Date(e.date);
    if (Number.isNaN(d.getTime())) return false;
    return currentMonth(d) === month;
  });
}

/**
 * Compare the plan against what actually happened.
 *
 * Two things this is careful about:
 *
 * - Spending in a category with no budget line is reported separately rather
 *   than ignored. A budget that quietly omits a third of your spending is
 *   worse than no budget, because it tells you that you are fine.
 * - Pacing is projected from days elapsed, so being 60% through the budget on
 *   the 10th reads as a problem rather than as "under budget".
 */
export function budgetStatus(plan: BudgetPlan, expenses: Expense[], now = new Date()): BudgetStatus {
  const inMonth = expensesInMonth(expenses, plan.month);
  const { days, elapsed } = monthProgress(plan.month, now);
  const pace = days / elapsed;

  const spentByCategory = new Map<string, number>();
  for (const e of inMonth) {
    const key = String(e.category ?? "other").toLowerCase();
    spentByCategory.set(key, (spentByCategory.get(key) ?? 0) + (Number(e.amount) || 0));
  }

  const claimed = new Set<string>();
  const lines: LineStatus[] = plan.lines.map((l) => {
    const key = l.category.toLowerCase();
    claimed.add(key);
    const spent = spentByCategory.get(key) ?? 0;
    const usedPct = l.limit > 0 ? (spent / l.limit) * 100 : spent > 0 ? Infinity : 0;
    const projected = Math.round(spent * pace);

    // "watch" is about the RATE, not the total: on track to overshoot even
    // though today's number still looks fine.
    const state: LineStatus["state"] =
      spent > l.limit ? "over" : projected > l.limit ? "watch" : "under";

    return {
      ...l,
      spent: Math.round(spent),
      remaining: Math.round(l.limit - spent),
      usedPct: Number.isFinite(usedPct) ? Math.round(usedPct) : 100,
      projected,
      state,
    };
  });

  const unbudgeted = [...spentByCategory.entries()]
    .filter(([cat]) => !claimed.has(cat))
    .map(([category, spent]) => ({ category, spent: Math.round(spent) }))
    .sort((a, b) => b.spent - a.spent);
  const unbudgetedTotal = unbudgeted.reduce((a, u) => a + u.spent, 0);

  const buckets: BucketStatus[] = BUCKETS.map((bucket) => {
    const own = lines.filter((l) => l.bucket === bucket);
    const limit = own.reduce((a, l) => a + l.limit, 0);
    const spent = own.reduce((a, l) => a + l.spent, 0);
    return {
      bucket,
      limit,
      spent,
      targetPct: plan.income > 0 ? Math.round((limit / plan.income) * 100) : 0,
      actualPct: plan.income > 0 ? Math.round((spent / plan.income) * 100) : 0,
    };
  });

  const totalBudget = lines.reduce((a, l) => a + l.limit, 0);
  const totalSpent = lines.reduce((a, l) => a + l.spent, 0) + unbudgetedTotal;
  const projectedTotal = Math.round(totalSpent * pace);

  const notes: string[] = [];
  if (unbudgetedTotal > 0) {
    notes.push(
      `₹${unbudgetedTotal.toLocaleString("en-IN")} went to categories with no budget line (${unbudgeted.slice(0, 3).map((u) => u.category).join(", ")}). Add lines for them, or the plan is only watching part of your spending.`,
    );
  }
  if (plan.income > 0 && totalBudget > plan.income) {
    notes.push(`The plan allocates ₹${(totalBudget - plan.income).toLocaleString("en-IN")} more than the income it is built on.`);
  }
  if (projectedTotal > totalBudget && totalBudget > 0 && elapsed < days) {
    notes.push(`At this rate you finish the month around ₹${projectedTotal.toLocaleString("en-IN")}, over the ₹${totalBudget.toLocaleString("en-IN")} planned.`);
  }
  const overs = lines.filter((l) => l.state === "over");
  if (overs.length) notes.push(`Already over on ${overs.map((l) => l.category).join(", ")}.`);

  return {
    month: plan.month,
    income: plan.income,
    days, elapsed,
    lines, buckets,
    totalBudget,
    totalSpent: Math.round(totalSpent),
    unbudgeted, unbudgetedTotal,
    projectedTotal,
    leftToSpend: Math.round(plan.income - totalSpent),
    notes,
  };
}

/**
 * Daily cumulative spend against a straight-line budget.
 *
 * The comparison people actually want is not two totals but two curves: where
 * the money went versus where an even month would have taken it. Crossing the
 * line is the moment worth seeing.
 */
export function spendCurve(plan: BudgetPlan, expenses: Expense[], now = new Date()): {
  day: number; spent: number; planned: number; future: boolean;
}[] {
  const inMonth = expensesInMonth(expenses, plan.month);
  const { days, elapsed } = monthProgress(plan.month, now);
  const totalBudget = plan.lines.reduce((a, l) => a + l.limit, 0);

  const byDay = new Array<number>(days + 1).fill(0);
  for (const e of inMonth) {
    const d = new Date(e.date);
    const day = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, day: "numeric" }).format(d));
    if (day >= 1 && day <= days) byDay[day] += Number(e.amount) || 0;
  }

  const out: { day: number; spent: number; planned: number; future: boolean }[] = [];
  let running = 0;
  for (let day = 1; day <= days; day++) {
    running += byDay[day];
    out.push({
      day,
      // Days that have not happened yet must not read as ₹0 spent — that
      // would draw the line flat along the bottom for the rest of the month
      // and look like you had stopped spending.
      spent: day <= elapsed ? Math.round(running) : Math.round(running),
      planned: Math.round((totalBudget / days) * day),
      future: day > elapsed,
    });
  }
  return out;
}
