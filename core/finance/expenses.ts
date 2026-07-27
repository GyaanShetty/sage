import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { searchGmail } from "@/infrastructure/integrations/google";

export const CATEGORIES = ["food", "transport", "shopping", "subscriptions", "bills", "entertainment", "health", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Expense {
  id: string;
  amount: number;        // in ₹
  merchant: string;
  category: Category;
  date: string;          // ISO
  recurring: boolean;    // subscription?
  source: "gmail" | "manual";
}

const TYPE = "finance.expense";

export async function listExpenses(days = 60): Promise<Expense[]> {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .gte("payload->>date", since)
    .limit(500);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Expense, "id">) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function addExpense(e: Partial<Expense>): Promise<string> {
  const id = crypto.randomUUID();
  await db.from("Event").insert({
    id, userId: DEFAULT_USER_ID, type: TYPE,
    payload: {
      amount: Number(e.amount) || 0, merchant: e.merchant ?? "—",
      category: (CATEGORIES as readonly string[]).includes(String(e.category)) ? e.category : "other",
      date: e.date ?? new Date().toISOString(), recurring: !!e.recurring, source: e.source ?? "manual",
    },
  });
  return id;
}

export async function deleteExpense(id: string): Promise<void> {
  await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
}

const scanSchema = z.object({
  expenses: z.array(z.object({
    amount: z.number().describe("Amount in INR (rupees)"),
    merchant: z.string(),
    category: z.enum(CATEGORIES),
    date: z.string().describe("ISO date of the transaction"),
    recurring: z.boolean().describe("true if a subscription/recurring charge"),
  })),
});

/** Scan Gmail for payment receipts & subscription renewals → expenses.
 *  Deduped against existing by merchant+amount+day. */
export async function scanExpenses(): Promise<{ added: number }> {
  const model = getModel("smart");
  if (!model) return { added: 0 };
  const emails = await searchGmail(
    'newer_than:45d (receipt OR "payment of" OR debited OR "you paid" OR subscription OR renewed OR invoice OR "order confirmed" OR "transaction" OR UPI)',
    30,
  ).catch(() => null);
  if (!emails?.length) return { added: 0 };

  const { object } = await generateObject({
    model, schema: scanSchema,
    system: `Extract personal spending from these emails: real money the user paid (card/UPI/subscriptions). Amount in INR. Skip credits, refunds, promotional 'you could save' emails, OTPs, and statements without a specific charge. Flag subscriptions (Netflix, Spotify, etc.) as recurring.`,
    prompt: emails.map((e, i) => `${i + 1}. From ${e.from} — ${e.subject}: ${e.snippet}`).join("\n"),
  }).catch(() => ({ object: { expenses: [] } }));

  const existing = await listExpenses(60);
  const key = (m: string, a: number, d: string) => `${m.toLowerCase()}|${Math.round(a)}|${d.slice(0, 10)}`;
  const seen = new Set(existing.map((e) => key(e.merchant, e.amount, e.date)));
  let added = 0;
  for (const x of object.expenses) {
    if (x.amount <= 0) continue;
    if (seen.has(key(x.merchant, x.amount, x.date))) continue;
    await addExpense({ ...x, source: "gmail" });
    added++;
  }
  return { added };
}

export interface ExpenseSummary { total: number; byCategory: Record<string, number>; recurring: { merchant: string; amount: number }[] }

export async function summarize(days = 30): Promise<ExpenseSummary> {
  const exps = await listExpenses(days);
  const byCategory: Record<string, number> = {};
  let total = 0;
  const subs = new Map<string, number>();
  for (const e of exps) {
    total += e.amount;
    byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    if (e.recurring) subs.set(e.merchant, e.amount);
  }
  return { total, byCategory, recurring: [...subs].map(([merchant, amount]) => ({ merchant, amount })) };
}
