import { NextResponse } from "next/server";
import { listExpenses, addExpense, deleteExpense, scanExpenses, summarize, knownCategories, type Expense } from "@/core/finance/expenses";

export const dynamic = "force-dynamic";

export async function GET() {
  // The categories come back with the expenses so the form can offer his own
  // budget envelopes rather than a list baked into the client.
  const [expenses, summary, categories] = await Promise.all([
    listExpenses(60),
    summarize(30),
    knownCategories().catch(() => []),
  ]);
  return NextResponse.json({ ok: true, data: { expenses, summary, categories } });
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
