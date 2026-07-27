import { NextResponse } from "next/server";
import { listExpenses, addExpense, deleteExpense, scanExpenses, summarize, type Expense } from "@/core/finance/expenses";

export const dynamic = "force-dynamic";

export async function GET() {
  const [expenses, summary] = await Promise.all([listExpenses(60), summarize(30)]);
  return NextResponse.json({ ok: true, data: { expenses, summary } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string } & Partial<Expense>;
  if (body.action === "scan") {
    const res = await scanExpenses().catch(() => ({ added: 0 }));
    return NextResponse.json({ ok: true, data: res });
  }
  const id = await addExpense(body);
  return NextResponse.json({ ok: true, data: { id } });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteExpense(id);
  return NextResponse.json({ ok: true });
}
