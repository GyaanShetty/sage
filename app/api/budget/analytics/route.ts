import { NextResponse } from "next/server";
import { analyse } from "@/core/finance/analytics";
import { currentMonth } from "@/core/finance/budget";

export const dynamic = "force-dynamic";

/**
 * The shapes in the spending: months, categories, days, merchants.
 *
 * Separate from /api/budget because it reads a year of expenses rather
 * than one month, and the budget page should render its headline numbers
 * without waiting on that.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const month = q.get("month") || currentMonth();
  const months = Math.min(24, Math.max(3, Number(q.get("months")) || 12));
  const data = await analyse(month, months);
  return NextResponse.json({ ok: true, data });
}
