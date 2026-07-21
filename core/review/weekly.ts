import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { sendGmail } from "@/infrastructure/integrations/google";
import { TZ, tzHour } from "@/lib/config";

const REVIEW_TO = process.env.SAGE_EMAIL ?? "gyaanshetty@gmail.com";

function tzWeekday(d = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
}

/**
 * Sunday evening (IST): email a review of the week — tasks shipped, journal
 * themes, memories learned. Called from the cron tick; sends at most once
 * per week (deduped via a weekly.review Event).
 */
export async function maybeSendWeeklyReview(): Promise<boolean> {
  if (tzWeekday() !== "Sun" || tzHour() < 18) return false;

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const { count } = await db
    .from("Event")
    .select("id", { count: "exact", head: true })
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "weekly.review")
    .gte("createdAt", threeDaysAgo);
  if ((count ?? 0) > 0) return false;

  const model = getModel("smart");
  if (!model) return false;

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [{ data: doneTasks }, { data: openTasks }, { data: memories }, { data: notes }] =
    await Promise.all([
      db.from("Task").select("title").eq("userId", DEFAULT_USER_ID).eq("status", "done").gte("updatedAt", weekAgo).limit(30),
      db.from("Task").select("title, priority").eq("userId", DEFAULT_USER_ID).neq("status", "done").limit(20),
      db.from("Memory").select("content").eq("userId", DEFAULT_USER_ID).gte("createdAt", weekAgo).limit(30),
      db.from("Note").select("title, content").eq("userId", DEFAULT_USER_ID).gte("updatedAt", weekAgo).limit(10),
    ]);

  const journal = (notes ?? [])
    .filter((n) => String(n.title ?? "").toLowerCase().includes("journal"))
    .map((n) => JSON.stringify(n.content).slice(0, 1500))
    .join("\n");

  const { text } = await generateText({
    model,
    prompt: `You are SAGE, Gyaan's personal AI chief of staff. Write his Sunday weekly review email. Plain text, warm but direct, under 350 words. Structure: a one-line verdict on the week, "Shipped" (from completed tasks), "Carrying over" (open tasks, flag the important ones), "Themes" (from journal entries, if any), "Learned" (interesting memories), and one concrete suggestion for next week. No markdown symbols, use simple caps headers.

Completed tasks this week: ${JSON.stringify((doneTasks ?? []).map((t) => t.title))}
Open tasks: ${JSON.stringify((openTasks ?? []).map((t) => t.title))}
New memories: ${JSON.stringify((memories ?? []).map((m) => m.content).slice(0, 25))}
Journal (raw): ${journal || "none"}`,
  });

  const sent = await sendGmail(REVIEW_TO, "SAGE · Your week in review", text);
  if (!sent) return false;

  await db.from("Event").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    type: "weekly.review",
    payload: { sentTo: REVIEW_TO },
  });
  return true;
}
