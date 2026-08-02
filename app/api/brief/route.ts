import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { getNews } from "@/infrastructure/news";
import { recentBriefs, noRepeatClause } from "@/core/brief/variety";
import { buildDayPicture, describeDay } from "@/core/brief/agenda";

export const maxDuration = 60;

/** Daily AI brief: generated once per ~6h window, cached in the event log. */
export async function GET(req: Request) {
  // ?refresh=1 forces a new one — for when the cached brief is stale in a way
  // the clock does not know about.
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: cached } = await db
    .from("Event")
    .select("payload, createdAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "brief.generated")
    .gte("createdAt", since)
    .order("createdAt", { ascending: false })
    .limit(1);
  if (cached?.length && !refresh) {
    return NextResponse.json({ ok: true, data: { text: (cached[0].payload as { text: string }).text, cached: true } });
  }

  const model = getModel("fast");
  if (!model) return NextResponse.json({ ok: true, data: { text: null } });


  // The day picture carries tasks, calendar, mail, reminders and goals, plus
  // the things that actually differ day to day — headlines and market moves —
  // which is what the old narrower gather was missing.
  const [picture, headlines, previous] = await Promise.all([
    buildDayPicture(),
    getNews(8).catch(() => []),
    recentBriefs("brief.generated", 4),
  ]);

  const { text } = await generateText({
    model,
    prompt: `You are SAGE, the user's chief of staff. Write a 2-3 sentence brief on where his day stands. Warm, direct, no fluff, no headers, no lists, and do NOT open with a greeting — jump straight into what matters most.

Lead with whatever is most pressing: an overdue task, the next commitment, a sharp market move. Be specific — real names, real times, real numbers, all of which are below. If there is genuinely little to report, say so gracefully and briefly.

${describeDay(picture)}

Headlines right now: ${headlines.map((h) => h.title).slice(0, 6).join(" | ") || "feeds quiet"}${noRepeatClause(previous)}`,
  });

  await db.from("Event").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    type: "brief.generated",
    payload: { text },
  });

  return NextResponse.json({ ok: true, data: { text, cached: false } });
}
