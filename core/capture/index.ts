import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { HUMAN_RULES } from "@/lib/config";

/**
 * Capture: one ramble in, filed things out.
 *
 * Getting data *in* is the bottleneck on everything else SAGE does. Every
 * feature here is only as good as what he remembered to type, and nobody types
 * on the walk home — which is exactly when the useful stuff surfaces.
 *
 * So: speak for two minutes, or share a screenshot, and this works out what is
 * in it and files each piece where it belongs. Every destination is a tool
 * that already exists; this is the parser in front of them.
 *
 * ── Why it proposes rather than acts ───────────────────────────────────────
 *
 * A misheard word becomes a task you did not ask for, a reminder at the wrong
 * hour, or a memory that is simply false — and a false memory is the worst of
 * the three, because it silently poisons every answer afterwards. So nothing
 * is written until he has seen the list. Confirming is one tap; unpicking a
 * bad write is not.
 */

export const KINDS = ["task", "reminder", "memory", "expense", "decision", "note", "question"] as const;
export type Kind = (typeof KINDS)[number];

const itemSchema = z.object({
  kind: z.enum(KINDS),
  /** What to write, in his words where possible. */
  text: z.string().describe("The content itself, cleaned up but not reworded"),
  /** ISO datetime, for reminders only. Empty when there is no time in it. */
  when: z.string().describe("ISO datetime if a time was mentioned, else empty string"),
  /** Rupees, for expenses only. Zero when not an expense. */
  amount: z.number().describe("Amount in rupees for an expense, else 0"),
  /** Where the money went, for expenses. */
  merchant: z.string().describe("Merchant for an expense, else empty string"),
  /**
   * Which of his own budget envelopes an expense belongs to.
   *
   * Chosen by the model from the real list, which is passed in — guessing it
   * afterwards by looking for a category name inside the sentence never
   * worked, because nobody says "I spent three hundred on the food category".
   */
  category: z.string().describe("For an expense: exactly one of the categories offered, else empty string"),
  /** Why this was classified as it was — shown so a wrong call is obvious. */
  because: z.string().describe("A few words on why this is that kind of thing"),
});

const captureSchema = z.object({
  items: z.array(itemSchema),
  /** Anything deliberately not filed, so nothing vanishes silently. */
  ignored: z.array(z.string()).describe("Fragments that were not actionable"),
});

export type CapturedItem = z.infer<typeof itemSchema>;
export interface Capture { items: CapturedItem[]; ignored: string[]; source: string }

const SYSTEM =
  `You are SAGE, sorting what Gyaan just said or showed you into things you can file. ${HUMAN_RULES} ` +
  "Split it into separate items — one thought, one item. Classify each:\n" +
  "- task: something he has to do\n" +
  "- reminder: something that must reach him at a specific time\n" +
  "- memory: a lasting fact about him, his people, or his preferences. Be strict — " +
  "a passing mood is not a memory, and a wrong one poisons every later answer\n" +
  "- expense: money already spent, with an amount\n" +
  "- decision: a call he is making, with a view about the future that could be scored later\n" +
  "- question: something he does not know and wants answered\n" +
  "- note: worth keeping but none of the above\n" +
  "Use his own words. Do not invent detail, do not infer times that were not said, " +
  "and put anything you are unsure about in `ignored` rather than guessing at it.";

/**
 * Parse a transcript — or a screenshot — into filable items.
 *
 * Nothing is written here. Images go in as images rather than being described
 * first: a screenshot of a timetable or a payment confirmation carries its
 * meaning in the layout, and a text summary of it loses exactly the numbers
 * that matter.
 */
export async function parseCapture(
  text: string,
  source = "voice",
  images: Buffer[] = [],
): Promise<Capture | { error: string }> {
  const clean = text.trim();
  if (clean.length < 3 && images.length === 0) return { error: "Nothing to file." };

  const model = getModel("smart") ?? getModel("fast");
  if (!model) return { error: "No model available right now." };

  // His real envelopes, offered to the model so an expense lands in one of
  // them rather than in "other".
  const categories = await import("@/core/finance/expenses")
    .then((m) => m.knownCategories())
    .catch(() => [] as string[]);

  const lead = images.length
    ? `What he shared — ${images.length} image(s), shown to you directly.${clean ? `\nHis note on it:\n${clean.slice(0, 4000)}` : ""}`
    : `What he said:\n${clean.slice(0, 8000)}`;

  try {
    const { object } = await generateObject({
      model,
      schema: captureSchema,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text" as const,
              text:
                `Today is ${new Date().toISOString()} (Asia/Kolkata).\n` +
                (categories.length ? `His budget categories: ${categories.join(", ")}. Use one of these verbatim for an expense.\n` : "") +
                `\n${lead}`,
            },
            ...images.map((image) => ({ type: "image" as const, image })),
          ],
        },
      ],
    });
    return { ...object, source };
  } catch (e) {
    return { error: `Couldn't sort that: ${(e as Error).message.slice(0, 140)}` };
  }
}

export interface FiledResult { kind: Kind; text: string; ok: boolean; detail?: string }

/**
 * Write the items he confirmed.
 *
 * Each kind goes through the same path the rest of the app uses, so a captured
 * expense lands in his real budget categories and a captured reminder is
 * delivered by the same ticker as any other. Nothing here is a parallel store.
 */
export async function fileItems(items: CapturedItem[]): Promise<FiledResult[]> {
  const out: FiledResult[] = [];

  /**
   * Supabase returns errors, it does not throw them.
   *
   * The first cut of this awaited the insert and moved on, so a row the
   * database rejected was reported back as filed. That is the worst possible
   * failure for this feature specifically: he ticks the list, sees seven green
   * ticks, closes the page, and the thing he wanted remembered is nowhere. Any
   * write that does not confirm now says so.
   */
  const insert = async (table: string, row: Record<string, unknown>) => {
    const { db } = await import("@/infrastructure/db/supabase");
    const { error } = await db.from(table).insert(row);
    if (error) throw new Error(error.message);
  };

  for (const item of items) {
    try {
      if (item.kind === "task") {
        const { DEFAULT_USER_ID, ensureDefaultUser } = await import("@/infrastructure/db/supabase");
        await ensureDefaultUser();
        const id = crypto.randomUUID();
        await insert("Task", { id, userId: DEFAULT_USER_ID, title: item.text.slice(0, 200), priority: 2 });
        // Mirrored to TickTick on a best-effort basis, as everywhere else.
        const { createTickTask } = await import("@/infrastructure/integrations/ticktick");
        await createTickTask({ title: item.text, dueAt: null, priority: 2 }).catch(() => null);
        out.push({ kind: item.kind, text: item.text, ok: true });

      } else if (item.kind === "reminder") {
        const when = item.when ? new Date(item.when) : null;
        if (!when || Number.isNaN(when.getTime())) {
          out.push({ kind: item.kind, text: item.text, ok: false, detail: "No time in it — filed as a task instead would be a guess." });
          continue;
        }
        const { DEFAULT_USER_ID } = await import("@/infrastructure/db/supabase");
        await insert("Reminder", {
          id: crypto.randomUUID(), userId: DEFAULT_USER_ID,
          text: item.text.slice(0, 200), remindAt: when.toISOString(),
        });
        out.push({ kind: item.kind, text: item.text, ok: true, detail: when.toLocaleString("en-GB", { timeZone: "Asia/Kolkata" }) });

      } else if (item.kind === "memory") {
        const { DEFAULT_USER_ID } = await import("@/infrastructure/db/supabase");
        const { embedText, toVectorLiteral } = await import("@/infrastructure/embeddings");
        const embedding = await embedText(item.text).catch(() => null);
        await insert("Memory", {
          id: crypto.randomUUID(), userId: DEFAULT_USER_ID,
          type: "fact", content: item.text.slice(0, 1000),
          importance: 0.6, confidence: 0.7,
          // Not nullable, and it earns its place: a memory he dictated deserves
          // to be distinguishable later from one SAGE inferred from a chat.
          sourceType: "capture",
          ...(embedding ? { embedding: toVectorLiteral(embedding) } : {}),
        });
        out.push({ kind: item.kind, text: item.text, ok: true });

      } else if (item.kind === "expense") {
        if (!item.amount) {
          out.push({ kind: item.kind, text: item.text, ok: false, detail: "No amount heard." });
          continue;
        }
        const { addExpense, knownCategories, normaliseCategory } = await import("@/core/finance/expenses");
        // The model picked from his real list; fall back to "other" only when
        // it picked something that is not on it.
        const known = await knownCategories().catch(() => [] as string[]);
        const picked = normaliseCategory(item.category || "other");
        const category = known.length === 0 || known.includes(picked) ? picked : "other";
        await addExpense({ amount: item.amount, merchant: item.merchant || "—", category, source: "manual" });
        out.push({ kind: item.kind, text: item.text, ok: true, detail: `₹${item.amount} · ${category}` });

      } else if (item.kind === "decision") {
        // Filed as an open call with a default review, because a decision
        // without a review date is a note.
        const { addDecision } = await import("@/core/decisions/store");
        const reviewAt = new Date();
        reviewAt.setMonth(reviewAt.getMonth() + 3);
        reviewAt.setHours(9, 0, 0, 0);
        await addDecision({
          title: item.text.slice(0, 200), reasoning: item.because, expectation: item.text.slice(0, 400),
          confidence: 70, domain: "life", reviewAt: reviewAt.toISOString(),
        });
        out.push({ kind: item.kind, text: item.text, ok: true, detail: "review in 3 months · confidence 70%, edit it on the page" });

      } else if (item.kind === "question") {
        const { DEFAULT_USER_ID } = await import("@/infrastructure/db/supabase");
        await insert("Event", {
          id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "education.log",
          payload: { skillId: "capture", kind: "question", text: item.text.slice(0, 2000), tags: [], at: new Date().toISOString(), resolvedAt: null },
        });
        // The night shift picks the oldest open question up on its own.
        out.push({ kind: item.kind, text: item.text, ok: true, detail: "the night shift will research it" });

      } else {
        const { DEFAULT_USER_ID, ensureDefaultUser } = await import("@/infrastructure/db/supabase");
        await ensureDefaultUser();
        await insert("Note", {
          id: crypto.randomUUID(), userId: DEFAULT_USER_ID,
          kind: "doc",
          title: item.text.slice(0, 60),
          // Note.content is a rich-text document, not a string, and updatedAt
          // has no default. Writing a bare string failed every single time.
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: item.text.slice(0, 4000) }] }] },
          updatedAt: new Date().toISOString(),
        });
        out.push({ kind: item.kind, text: item.text, ok: true });
      }
    } catch (e) {
      out.push({ kind: item.kind, text: item.text, ok: false, detail: (e as Error).message.slice(0, 120) });
    }
  }

  return out;
}
