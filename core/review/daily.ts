import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ, tzHour } from "@/lib/config";

function tzDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/**
 * Daily learning loop. Each evening (IST, after 21:00), SAGE looks back at
 * what Gyaan actually touched today — tasks shipped, notes written, memories
 * learned, topics researched — and writes a short "Today you explored…" note
 * into the workspace. Over time these notes feed the Mind Graph, so the day's
 * threads compound into a picture of what he's into. Deduped to once per day
 * via a daily.digest Event; a no-op on quiet days with nothing to say.
 */
export async function maybeSaveDailyDigest(): Promise<boolean> {
  if (tzHour() < 21) return false;

  const day = tzDay();
  const { data: already } = await db
    .from("Event")
    .select("id")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "daily.digest")
    .gte("createdAt", `${day}T00:00:00`)
    .limit(1)
    .maybeSingle();
  if (already) return false;

  const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const [{ data: doneTasks }, { data: notes }, { data: memories }, { data: searches }] =
    await Promise.all([
      db.from("Task").select("title").eq("userId", DEFAULT_USER_ID).eq("status", "done").gte("updatedAt", since).limit(20),
      db.from("Note").select("title").eq("userId", DEFAULT_USER_ID).gte("updatedAt", since).limit(20),
      db.from("Memory").select("content").eq("userId", DEFAULT_USER_ID).gte("createdAt", since).limit(20),
      db.from("Event").select("payload").eq("userId", DEFAULT_USER_ID).eq("type", "search").gte("createdAt", since).limit(20),
    ]);

  const done = (doneTasks ?? []).map((t) => t.title);
  const noteTitles = (notes ?? []).map((n) => n.title).filter(Boolean);
  const learned = (memories ?? []).map((m) => m.content);
  const queries = (searches ?? [])
    .map((s) => (s.payload as { query?: string } | null)?.query)
    .filter(Boolean);

  // Nothing meaningful happened — stay silent but still stake the claim so we
  // don't re-scan repeatedly through the evening.
  const hasSignal = done.length + noteTitles.length + learned.length + queries.length > 0;
  if (!hasSignal) {
    await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "daily.digest", payload: { day, empty: true } });
    return false;
  }

  const model = getModel("fast");
  const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const title = `Learning log — ${dateLabel}`;

  let body: string;
  if (model) {
    const { text } = await generateText({
      model,
      prompt: `You are SAGE, Gyaan's chief of staff. Write a short, warm daily "learning log" note (120-180 words, plain prose, no markdown headers) reflecting what he engaged with today. Draw threads between the items — what themes emerged, what he seems to be digging into. Second person ("you"). If a couple of items connect, say so. End with one gentle forward pointer for tomorrow.

Tasks shipped: ${JSON.stringify(done)}
Notes written: ${JSON.stringify(noteTitles)}
Things I learned about you: ${JSON.stringify(learned)}
Topics you searched: ${JSON.stringify(queries)}`,
    }).catch(() => ({ text: "" }));
    body = text.trim();
  } else {
    body = "";
  }

  if (!body) {
    const bits: string[] = [];
    if (done.length) bits.push(`You shipped ${done.length} task${done.length === 1 ? "" : "s"}: ${done.slice(0, 5).join(", ")}.`);
    if (noteTitles.length) bits.push(`You wrote about ${noteTitles.slice(0, 5).join(", ")}.`);
    if (queries.length) bits.push(`You explored ${queries.slice(0, 5).join(", ")}.`);
    body = bits.join(" ");
  }

  const paragraphs = body
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] }));

  await db.from("Note").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    kind: "doc",
    title,
    content: { type: "doc", content: paragraphs },
    aiGenerated: true,
    updatedAt: new Date().toISOString(),
  });
  await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "daily.digest", payload: { day, title } });
  return true;
}
