import { startOfTodayUtc, tzDay } from "@/lib/config";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export interface Card {
  id: string;
  front: string;
  back: string;
  source: string;
  ease: number;      // SM-2 ease factor
  interval: number;  // days
  reps: number;
  dueAt: string;     // ISO
}

const TYPE = "review.card";

export async function dueCards(limit = 20): Promise<Card[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .lte("payload->>dueAt", new Date().toISOString())
    .limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Card, "id">) }));
}

export async function allCardsCount(): Promise<number> {
  const { count } = await db.from("Event").select("id", { count: "exact", head: true })
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE);
  return count ?? 0;
}

/**
 * SM-2 lite: grade 0-5 (again<3, good=4, easy=5).
 *
 * Pure, so it can be tested exactly. It used to trust its inputs, and every
 * one of them could ruin a card permanently rather than for one review:
 *
 * - An out-of-range or non-numeric grade fed straight into the ease formula.
 *   grade=7 nudges ease UP by more than a perfect answer should; NaN poisons
 *   ease, then interval, and `new Date(NaN)` throws when serialised — a card
 *   that can never be scheduled again.
 * - A card missing `ease` (an older row, a partial write) produced the same
 *   NaN cascade.
 * - Nothing capped the interval, so a long streak could schedule the next
 *   review a decade out. That is not retention, that is deletion with extra
 *   steps.
 */
export const MAX_INTERVAL_DAYS = 365;

export function schedule(
  card: { ease?: number; interval?: number; reps?: number },
  rawGrade: number,
): { ease: number; interval: number; reps: number; dueInDays: number } {
  // Clamp rather than reject: a grade is a UI affordance, and refusing the
  // review outright would lose the answer the user actually gave.
  const grade = Number.isFinite(rawGrade) ? Math.min(5, Math.max(0, Math.round(rawGrade))) : 0;

  let ease = Number.isFinite(card.ease) ? (card.ease as number) : 2.5;
  let interval = Number.isFinite(card.interval) ? (card.interval as number) : 0;
  let reps = Number.isFinite(card.reps) ? (card.reps as number) : 0;

  if (grade < 3) {
    // A lapse resets the schedule but keeps the ease it has earned — SM-2
    // treats difficulty as a property of the card, not of one bad morning.
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
    ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  }

  interval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, interval));
  return { ease, interval, reps, dueInDays: interval };
}

export async function gradeCard(id: string, grade: number): Promise<void> {
  const { data } = await db.from("Event").select("payload").eq("id", id).maybeSingle();
  const c = data?.payload as Omit<Card, "id"> | undefined;
  if (!c) return;
  const next = schedule(c, grade);
  const dueAt = new Date(Date.now() + next.dueInDays * 864e5).toISOString();
  await db
    .from("Event")
    .update({ payload: { ...c, ease: next.ease, interval: next.interval, reps: next.reps, dueAt } })
    .eq("id", id);
}

async function addCards(cards: { front: string; back: string }[], source: string): Promise<number> {
  let n = 0;
  for (const c of cards) {
    if (!c.front?.trim() || !c.back?.trim()) continue;
    await db.from("Event").insert({
      id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE,
      payload: { front: c.front.trim(), back: c.back.trim(), source, ease: 2.5, interval: 0, reps: 0, dueAt: new Date().toISOString() },
    });
    n++;
  }
  return n;
}

const genSchema = z.object({ cards: z.array(z.object({ front: z.string(), back: z.string() })) });

/** Generate review cards from the day's learning — notes + morning synthesis +
 *  learned memories — so consumption becomes retained knowledge. Once/day. */
export async function generateDailyCards(): Promise<number> {
  const day = tzDay(new Date());
  const { data: already } = await db.from("Event").select("id")
    .eq("userId", DEFAULT_USER_ID).eq("type", "review.generated")
    .gte("createdAt", startOfTodayUtc()).limit(1).maybeSingle();
  if (already) return 0;

  const model = getModel("fast");
  if (!model) return 0;

  const since = new Date(Date.now() - 26 * 3600e3).toISOString();
  const [{ data: notes }, { data: mems }, { data: syn }] = await Promise.all([
    db.from("Note").select("title").eq("userId", DEFAULT_USER_ID).gte("updatedAt", since).limit(10),
    db.from("Memory").select("content").eq("userId", DEFAULT_USER_ID).gte("createdAt", since).limit(15),
    db.from("Event").select("payload").eq("userId", DEFAULT_USER_ID).eq("type", "morning.synthesis").order("createdAt", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const synData = (syn?.payload as { data?: { summary?: string; connections?: string[] } } | null)?.data;
  const material = [
    ...(notes ?? []).map((n) => `Note: ${n.title}`),
    ...(mems ?? []).map((m) => `Learned: ${m.content}`),
    synData?.summary ? `Morning read: ${synData.summary}` : "",
    ...(synData?.connections ?? []),
  ].filter(Boolean).join("\n");
  if (!material) return 0;

  const { object } = await generateObject({
    model, schema: genSchema,
    system: "Turn today's learning into 3-6 concise spaced-repetition flashcards. Front = a sharp question; back = a crisp answer. Only genuinely worth-remembering concepts; skip trivia and anything time-bound.",
    prompt: material,
  }).catch(() => ({ object: { cards: [] } }));

  const n = await addCards(object.cards, "daily");
  await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "review.generated", payload: { day, n } });
  return n;
}
