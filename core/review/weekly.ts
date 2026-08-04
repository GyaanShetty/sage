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
 * Everything the week actually contained.
 *
 * Each of these already derives its own conclusions elsewhere — how training
 * is trending, what the budget did, which questions are still unanswered —
 * so the review reads those rather than re-deriving them from raw rows. Two
 * summaries of the same data that disagree is worse than one that is thin.
 *
 * All of it is swallowed on failure. A review missing its training section is
 * a smaller loss than no review at all.
 */
async function weekContext(): Promise<string[]> {
  const lines: string[] = [];

  const [training, study, budget, career] = await Promise.all([
    (async () => {
      const { trainingProgress } = await import("@/core/health/progression");
      return trainingProgress(28);
    })().catch(() => null),

    (async () => {
      const { listEntries, studyStats } = await import("@/core/education/log");
      const { listSkills } = await import("@/core/education/skills");
      const [entries, skills] = await Promise.all([listEntries(), listSkills()]);
      return { stats: studyStats(entries), skills };
    })().catch(() => null),

    (async () => {
      const { getPlan, budgetStatus, currentMonth } = await import("@/core/finance/budget");
      const { listExpenses } = await import("@/core/finance/expenses");
      const plan = await getPlan(currentMonth());
      return plan ? budgetStatus(plan, await listExpenses(60)) : null;
    })().catch(() => null),

    (async () => {
      const { pipelineReport, needsAttention } = await import("@/core/career/pipeline");
      const { insights, funnel } = await pipelineReport();
      return { ...needsAttention(insights), funnel };
    })().catch(() => null),
  ]);

  if (training) {
    const week = training.weeklyVolume.at(-1);
    if (week) lines.push(`TRAINING: ${week.sessions} session${week.sessions === 1 ? "" : "s"} last week, ${Math.round(week.volumeKg).toLocaleString()}kg moved.`);
    const fresh = training.records.filter((r) => r.daysAgo <= 7);
    if (fresh.length) lines.push(`  New bests: ${fresh.map((r) => `${r.lift} ${r.kg}kg (was ${r.previousKg})`).join(", ")}`);
    if (training.neglected.length) lines.push(`  Untouched for 3+ weeks: ${training.neglected.map((l) => l.name).join(", ")}`);
    if (training.suggestion) lines.push(`  Next session should be: ${training.suggestion.focus.join(", ")} — ${training.suggestion.reason}`);
  }

  if (study) {
    const weekMinutes = study.stats.recent.slice(-7).reduce((a, r) => a + r.minutes, 0);
    lines.push(`STUDY: ${Math.round((weekMinutes / 60) * 10) / 10}h logged in the last seven days.`);
    if (study.stats.openQuestions.length) {
      lines.push(`  Still unanswered: ${study.stats.openQuestions.slice(0, 4).map((q) => `"${q.text.slice(0, 80)}"`).join("; ")}`);
    }
    const stale = study.skills
      .filter((s) => s.lastPractisedAt && Date.now() - new Date(s.lastPractisedAt).getTime() > 14 * 86_400_000)
      .slice(0, 4);
    if (stale.length) lines.push(`  Skills going cold: ${stale.map((s) => s.name).join(", ")}`);
  }

  if (budget) {
    lines.push(`MONEY: ₹${budget.totalSpent.toLocaleString("en-IN")} spent of ₹${budget.totalBudget.toLocaleString("en-IN")} planned, on pace for ₹${budget.projectedTotal.toLocaleString("en-IN")}.`);
    if (budget.lines.some((l) => l.state === "over")) {
      lines.push(`  Over on: ${budget.lines.filter((l) => l.state === "over").map((l) => l.category).join(", ")}`);
    }
  }

  if (career) {
    if (career.dueSoon.length) lines.push(`CAREER: deadlines inside a week — ${career.dueSoon.map((i) => `${i.company} (${i.daysToDeadline}d)`).join(", ")}`);
    if (career.stale.length) lines.push(`  Gone quiet: ${career.stale.slice(0, 4).map((i) => i.company).join(", ")}`);
  }

  return lines;
}

/**
 * Sunday evening (IST): email a review of the week — tasks shipped, journal
 * themes, memories learned, and how the rest of his life actually went.
 * Called from the cron tick; sends at most once per week (deduped via a
 * weekly.review Event).
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

  const context = await weekContext();

  const journal = (notes ?? [])
    .filter((n) => String(n.title ?? "").toLowerCase().includes("journal"))
    .map((n) => JSON.stringify(n.content).slice(0, 1500))
    .join("\n");

  const { text } = await generateText({
    model,
    prompt: `You are SAGE, Gyaan's personal AI chief of staff. Write his Sunday weekly review email. Plain text, warm but direct, under 450 words. No markdown symbols; use simple caps headers.

Structure: a one-line verdict on the week, then SHIPPED (completed tasks), BODY (training), MIND (studying), MONEY (budget), PIPELINE (applications) — skipping any section with nothing real to say rather than padding it — then CARRYING OVER (open tasks, flag what matters), and one concrete suggestion for next week.

Rules:
- Use the actual numbers below. "You trained a few times" is worthless when the exact figure is right there.
- Do not congratulate him for a week that was thin. If training or study went quiet, say so plainly; that is the whole value of a review.
- One suggestion, not five. Pick the thing with the most leverage.

Completed tasks this week: ${JSON.stringify((doneTasks ?? []).map((t) => t.title))}
Open tasks: ${JSON.stringify((openTasks ?? []).map((t) => t.title))}
New memories: ${JSON.stringify((memories ?? []).map((m) => m.content).slice(0, 25))}
Journal (raw): ${journal || "none"}

The rest of his week:
${context.length ? context.join("\n") : "No training, study, budget or pipeline data this week."}`,
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
