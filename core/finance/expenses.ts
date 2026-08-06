import { generateObject } from "ai";
import { trashRow } from "@/core/ops/trash";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { searchGmail } from "@/infrastructure/integrations/google";

/**
 * Categories: his, not mine.
 *
 * These eight are the seed for a budget that has not been written yet. They
 * were being enforced as the only permitted values, so an expense in any
 * category he had invented in the budget table — "mess", "rent", "books" — was
 * silently rewritten to "other" on the way in. Then the budget matched spending
 * to lines by category name, found nothing, and reported his real categories as
 * unbudgeted while "other" quietly swallowed everything. Hence money landing in
 * places he never chose.
 *
 * So the list below is a suggestion. The authority on what categories exist is
 * the budget he wrote — see `knownCategories()`.
 */
export const CATEGORIES = ["food", "transport", "shopping", "subscriptions", "bills", "entertainment", "health", "other"] as const;
/** Any label he uses. Constrained to a fixed union, it constrained the wrong thing. */
export type Category = string;
export type DefaultCategory = (typeof CATEGORIES)[number];

/**
 * Compare categories the way the budget does: case and spacing are not
 * meaningful, so "Mess Fees" and "mess fees" must be the same envelope.
 */
export function normaliseCategory(raw: unknown): string {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return s ? s.slice(0, 40) : "other";
}

/**
 * Every category he can file something under: the lines of the current budget
 * first, since those are the ones he chose, then the defaults for anything he
 * has not thought about yet.
 */
export async function knownCategories(): Promise<string[]> {
  const { getPlan } = await import("./budget");
  const plan = await getPlan().catch(() => null);
  const mine = (plan?.lines ?? []).map((l) => normaliseCategory(l.category)).filter(Boolean);
  return [...new Set([...mine, ...CATEGORIES])];
}

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
      // Kept as typed, not snapped to a fixed list. The budget matches on this
      // string, so rewriting it here is what broke the join in the first place.
      category: normaliseCategory(e.category),
      date: e.date ?? new Date().toISOString(), recurring: !!e.recurring, source: e.source ?? "manual",
    },
  });
  return id;
}

export async function deleteExpense(id: string): Promise<void> {
  await trashRow("Event", id);
}

const scanSchema = z.object({
  expenses: z.array(z.object({
    amount: z.number().describe("Amount in INR (rupees)"),
    merchant: z.string(),
    // Free text rather than a fixed enum, because the allowed set is his
    // budget and that is not known at module load. It is snapped to a real
    // category below.
    category: z.string().describe("One of the category names given in the instructions"),
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

  // Scanned expenses must land in the same envelopes he budgets with, or the
  // budget reports them as unbudgeted spending in categories he never made.
  const allowed = await knownCategories();

  const { object } = await generateObject({
    model, schema: scanSchema,
    system: `Extract personal spending from these emails: real money the user paid (card/UPI/subscriptions). Amount in INR. Skip credits, refunds, promotional 'you could save' emails, OTPs, and statements without a specific charge. Flag subscriptions (Netflix, Spotify, etc.) as recurring. ` +
      `Categorise each into exactly one of these, copying the name verbatim: ${allowed.join(", ")}. Use "other" only when none of them fits.`,
    prompt: emails.map((e, i) => `${i + 1}. From ${e.from} — ${e.subject}: ${e.snippet}`).join("\n"),
  }).catch(() => ({ object: { expenses: [] } }));

  const existing = await listExpenses(60);
  const key = (m: string, a: number, d: string) => `${m.toLowerCase()}|${Math.round(a)}|${d.slice(0, 10)}`;
  const seen = new Set(existing.map((e) => key(e.merchant, e.amount, e.date)));
  let added = 0;
  const allowedSet = new Set(allowed.map(normaliseCategory));
  for (const x of object.expenses) {
    if (x.amount <= 0) continue;
    if (seen.has(key(x.merchant, x.amount, x.date))) continue;
    // A model asked for one of N names will occasionally return an N+1th. An
    // invented category would show up as a new envelope in his budget, so
    // anything off-list becomes "other" — visible and easy to reassign.
    const cat = normaliseCategory(x.category);
    await addExpense({ ...x, category: allowedSet.has(cat) ? cat : "other", source: "gmail" });
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
