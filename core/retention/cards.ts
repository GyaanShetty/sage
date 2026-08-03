import { startOfTodayUtc } from "@/lib/config";
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

/** SM-2 lite: grade 0-5 (again<3, good=4, easy=5). */
export async function gradeCard(id: string, grade: number): Promise<void> {
  const { data } = await db.from("Event").select("payload").eq("id", id).maybeSingle();
  const c = data?.payload as Omit<Card, "id"> | undefined;
  if (!c) return;
  let { ease, interval, reps } = c;
  if (grade < 3) { reps = 0; interval = 1; }
  else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
    ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  }
  const dueAt = new Date(Date.now() + interval * 864e5).toISOString();
  await db.from("Event").update({ payload: { ...c, ease, interval, reps, dueAt } }).eq("id", id);
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
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
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
