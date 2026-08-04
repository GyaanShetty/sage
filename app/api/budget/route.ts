import { NextResponse } from "next/server";
import {
  getPlan, savePlan, copyPlan, applyRule, budgetStatus, spendCurve,
  currentMonth, BUCKETS, type BudgetLine, type Bucket,
} from "@/core/finance/budget";
import { listExpenses } from "@/core/finance/expenses";

export const dynamic = "force-dynamic";

/** Expenses reaching back far enough to cover any month being viewed. */
async function expensesFor(month: string) {
  const [y, m] = month.split("-").map(Number);
  const monthsBack = Math.max(1, Math.round((Date.now() - new Date(y, m - 1, 1).getTime()) / 2.6e9) + 1);
  return listExpenses(Math.min(400, monthsBack * 31 + 5));
}

export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month") || currentMonth();
  const [plan, expenses] = await Promise.all([getPlan(month), expensesFor(month)]);

  if (!plan) {
    // No plan yet: say so plainly rather than inventing one. The UI offers to
    // seed it, which is a decision the user should make, not a default they
    // discover later.
    return NextResponse.json({ ok: true, data: { month, plan: null, status: null, curve: [] } });
  }

  return NextResponse.json({
    ok: true,
    data: {
      month,
      plan,
      status: budgetStatus(plan, expenses),
      curve: spendCurve(plan, expenses),
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: "seed" | "save" | "copy";
    month?: string;
    from?: string;
    income?: number;
    split?: Record<Bucket, number>;
    basis?: "50-30-20" | "custom";
    lines?: BudgetLine[];
  };
  const month = body.month || currentMonth();

  if (body.action === "copy") {
    const plan = await copyPlan(body.from || "", month);
    if (!plan) return NextResponse.json({ ok: false, error: "Nothing to copy from that month." }, { status: 400 });
    return NextResponse.json({ ok: true, data: { plan } });
  }

  if (body.action === "seed") {
    const income = Number(body.income) || 0;
    if (income <= 0) return NextResponse.json({ ok: false, error: "Set a monthly income first." }, { status: 400 });

    const split = body.split ?? { needs: 50, wants: 30, savings: 20 };
    const sum = BUCKETS.reduce((a, b) => a + (Number(split[b]) || 0), 0);
    // A split that does not add to 100 silently under- or over-budgets the
    // month, and the error would only show up as a plan that never balances.
    if (Math.abs(sum - 100) > 0.5) {
      return NextResponse.json({ ok: false, error: `The split adds up to ${sum}%, not 100%.` }, { status: 400 });
    }

    const plan = await savePlan({ month, income, basis: "50-30-20", lines: applyRule(income, split) });
    return NextResponse.json({ ok: true, data: { plan } });
  }

  // Plain save of an edited plan.
  const lines = (body.lines ?? [])
    .filter((l) => l && typeof l.category === "string" && l.category.trim())
    .map((l) => ({
      id: l.id || crypto.randomUUID(),
      category: l.category.trim().slice(0, 40),
      bucket: (BUCKETS.includes(l.bucket) ? l.bucket : "wants") as Bucket,
      limit: Math.max(0, Math.round(Number(l.limit) || 0)),
    }));

  const plan = await savePlan({
    month,
    income: Math.max(0, Math.round(Number(body.income) || 0)),
    basis: body.basis === "50-30-20" ? "50-30-20" : "custom",
    lines,
  });
  return NextResponse.json({ ok: true, data: { plan } });
}
