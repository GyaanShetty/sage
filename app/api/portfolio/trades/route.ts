import { NextResponse } from "next/server";
import { addTrade, deleteTrade, listTrades, realizeFifo, listIncome, addIncome, deleteIncome, taxReport, financialYear, type Trade } from "@/core/portfolio/trades";

export const dynamic = "force-dynamic";

/** Trade log + realized P&L + income + capital-gains report. */
export async function GET(req: Request) {
  const fy = new URL(req.url).searchParams.get("fy") ?? financialYear(new Date());
  const [trades, income] = await Promise.all([listTrades(), listIncome()]);
  const realized = realizeFifo(trades);
  const report = taxReport(realized, income, fy);

  // every FY that has activity, newest first — for the report's year picker
  const years = Array.from(
    new Set([...realized.map((r) => financialYear(r.closedAt)), ...income.map((i) => financialYear(i.date))]),
  ).sort().reverse();

  const realizedTotal = realized.reduce((a, r) => a + r.pnl, 0);
  const incomeTotal = income.reduce((a, i) => a + i.amount, 0);

  return NextResponse.json({
    ok: true,
    data: { trades, income, realized, realizedTotal, incomeTotal, report, years },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<Trade> & { entry?: "trade" | "income"; kind?: string };
  if (body.entry === "income") {
    const id = await addIncome(body as never);
    return NextResponse.json({ ok: true, data: { id } });
  }
  if (!body.symbol || !body.qty) {
    return NextResponse.json({ ok: false, error: "symbol and qty required" }, { status: 400 });
  }
  const id = await addTrade(body);
  return NextResponse.json({ ok: true, data: { id } });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  if (url.searchParams.get("entry") === "income") await deleteIncome(id);
  else await deleteTrade(id);
  return NextResponse.json({ ok: true });
}
