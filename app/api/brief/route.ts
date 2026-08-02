import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listUnreadEmails, listUpcomingEvents } from "@/infrastructure/integrations/google";
import { getNews } from "@/infrastructure/news";
import { getMarkets } from "@/infrastructure/markets";
import { recentBriefs, noRepeatClause, dayContext } from "@/core/brief/variety";
import { TZ } from "@/lib/config";

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

  const [{ data: tasks }, { data: reminders }, { data: goals }, events, emails] = await Promise.all([
    db
      .from("Task")
      .select("title, dueAt, priority")
      .eq("userId", DEFAULT_USER_ID)
      .in("status", ["todo", "doing"])
      .order("priority")
      .limit(10),
    db
      .from("Reminder")
      .select("text, remindAt")
      .eq("userId", DEFAULT_USER_ID)
      .eq("status", "pending")
      .order("remindAt")
      .limit(5),
    db
      .from("Memory")
      .select("content")
      .eq("userId", DEFAULT_USER_ID)
      .eq("type", "goal")
      .is("supersededBy", null)
      .order("importance", { ascending: false })
      .limit(3),
    listUpcomingEvents(5).catch(() => null),
    listUnreadEmails(5).catch(() => null),
  ]);

  // Things that actually differ from one day to the next. Without these the
  // model sees the same task list two mornings running and writes the same
  // brief, which is exactly what it was doing.
  const [headlines, markets, previous] = await Promise.all([
    getNews(8).catch(() => []),
    getMarkets().catch(() => null),
    recentBriefs("brief.generated", 4),
  ]);

  const { text } = await generateText({
    model,
    prompt: `You are SAGE, the user's chief of staff. Write a 2-3 sentence brief. Warm, direct, no fluff, no headers, no lists, and do NOT start with a greeting like "Good morning" — jump straight into what matters most right now. If there's little to report, say so gracefully.

Now: ${new Date().toString()}
Open tasks: ${JSON.stringify(tasks ?? [])}
Pending reminders: ${JSON.stringify(reminders ?? [])}
Their goals: ${JSON.stringify(goals?.map((g) => g.content) ?? [])}
Calendar (next events): ${events ? JSON.stringify(events) : "not connected"}
Unread email: ${emails ? JSON.stringify(emails.map((e) => ({ from: e.from, subject: e.subject }))) : "not connected"}
${dayContext(TZ)}
Headlines right now: ${headlines.map((h) => h.title).join(" | ") || "feeds quiet"}
Market moves: ${(markets ?? []).slice(0, 6).map((c) => `${c.symbol} ${c.change24h}%`).join(", ") || "unavailable"}${noRepeatClause(previous)}`,
  });

  await db.from("Event").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    type: "brief.generated",
    payload: { text },
  });

  return NextResponse.json({ ok: true, data: { text, cached: false } });
}
