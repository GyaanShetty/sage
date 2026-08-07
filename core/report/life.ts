import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listApplications } from "@/core/career/scan";
import { analyse } from "@/core/career/pipeline";
import { APP_NAME, OWNER } from "@/lib/config";

/**
 * The life report — one read across every domain at once.
 *
 * Each subsystem could already answer questions about itself, and the weekly
 * email covered tasks and notes. Nothing ever looked at them *together*, which
 * is where the only interesting observations live: applications stalling in
 * the same week the task list bloated, spending climbing while sleep fell.
 * A per-domain page cannot see that, because the correlation is between pages.
 *
 * Signals are gathered as plain numbers first and the model is given only the
 * summary. It never sees raw rows, so it cannot invent a transaction or an
 * application that does not exist — everything it can cite is already a fact
 * computed here.
 */

const DAY = 86_400_000;

/**
 * Deliberately unconstrained: `.max()` on arrays and strings made Gemini's
 * structured output fail outright ("response did not match schema") rather
 * than truncate. Limits are applied after generation instead, where a long
 * answer gets trimmed rather than thrown away.
 */
export const reportSchema = z.object({
  headline: z.string().describe("One sentence: the single most important thing about this period"),
  moved: z.array(z.string()).describe("What genuinely progressed. Up to 5."),
  slipping: z.array(z.string()).describe("What went backwards or stalled. Up to 5."),
  patterns: z.array(z.string())
    .describe("Up to 3 connections ACROSS domains that no single page would show. Empty list rather than reaching."),
  recommendations: z.array(z.object({
    title: z.string(),
    why: z.string(),
    action: z.string().describe("One concrete thing to do this week"),
  })).describe("At most 3."),
});

export type LifeReport = z.infer<typeof reportSchema> & { period: number; generatedAt: string; signals: Signals };

export interface Signals {
  days: number;
  tasks: { done: number; open: number; overdue: number; created: number };
  career: { total: number; interviewRatePct: number; offerRatePct: number; quiet: number; movedStages: number };
  money: { spend: number; byCategory: Record<string, number>; holdings: number };
  health: { avgSteps: number | null; avgSleep: number | null; workouts: number };
  mind: { memoriesAdded: number; notesWritten: number; retired: number };
  ops: { automationRuns: number; automationFailures: number; briefsGenerated: number };
}

async function countEvents(type: string, since: string): Promise<number> {
  const { count } = await db
    .from("Event")
    .select("id", { count: "exact", head: true })
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", type)
    .gte("createdAt", since);
  return count ?? 0;
}

async function payloads<T>(type: string, since: string, limit = 400): Promise<T[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", type)
    .gte("createdAt", since)
    .limit(limit);
  return (data ?? []).map((r) => r.payload as T);
}

/** AutomationRun carries no userId of its own, so it has to be scoped through
 *  the automations that own the runs — counting the table directly would tally
 *  every user's runs. */
async function userAutomationRuns(since: string): Promise<{ status: string }[]> {
  const { data: mine } = await db
    .from("Automation")
    .select("id")
    .eq("userId", DEFAULT_USER_ID);
  const ids = (mine ?? []).map((a) => a.id as string);
  if (ids.length === 0) return [];
  const { data } = await db
    .from("AutomationRun")
    .select("status")
    .in("automationId", ids)
    .gte("startedAt", since);
  return (data ?? []) as { status: string }[];
}

/** Everything the report is allowed to talk about, as numbers. */
export async function gatherSignals(days = 7): Promise<Signals> {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const nowIso = new Date().toISOString();

  const [
    doneTasks, openTasks, overdueTasks, createdTasks,
    apps,
    expenses, holdings,
    health, workouts,
    memoriesAdded, notes, retired,
    automationRuns, briefs,
  ] = await Promise.all([
    db.from("Task").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID).eq("status", "done").gte("updatedAt", since),
    db.from("Task").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID).neq("status", "done").neq("status", "cancelled"),
    db.from("Task").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID).neq("status", "done").neq("status", "cancelled").lt("dueAt", nowIso).not("dueAt", "is", null),
    db.from("Task").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID).gte("createdAt", since),
    listApplications().catch(() => []),
    payloads<{ amount?: number; category?: string; at?: string }>("finance.expense", since),
    db.from("Event").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID).eq("type", "portfolio.holding"),
    payloads<{ steps?: number; sleepHours?: number }>("health.report", since, 40),
    countEvents("health.workout", since),
    db.from("Memory").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID).gte("createdAt", since),
    db.from("Note").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID).gte("updatedAt", since),
    db.from("Memory").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID).not("supersededBy", "is", null).gte("createdAt", since),
    userAutomationRuns(since),
    countEvents("debrief.generated", since),
  ]);

  const { funnel, insights } = analyse(apps);
  // Stage moves inside the window — the pipeline's actual motion, as opposed
  // to its size, which barely changes week to week.
  const movedStages = apps.reduce((n, a) => n + (a.history ?? []).filter((h) => h.at >= since).length, 0);

  const byCategory: Record<string, number> = {};
  let spend = 0;
  for (const e of expenses) {
    const amt = e.amount ?? 0;
    spend += amt;
    byCategory[e.category ?? "other"] = (byCategory[e.category ?? "other"] ?? 0) + amt;
  }

  const stepDays = health.filter((h) => typeof h.steps === "number");
  const sleepDays = health.filter((h) => typeof h.sleepHours === "number");
  const runs = automationRuns;

  return {
    days,
    tasks: {
      done: doneTasks.count ?? 0, open: openTasks.count ?? 0,
      overdue: overdueTasks.count ?? 0, created: createdTasks.count ?? 0,
    },
    career: {
      total: funnel.total,
      interviewRatePct: Math.round(funnel.interviewRate * 100),
      offerRatePct: Math.round(funnel.offerRate * 100),
      quiet: insights.filter((i) => i.stale).length,
      movedStages,
    },
    money: { spend: Math.round(spend), byCategory, holdings: holdings.count ?? 0 },
    health: {
      avgSteps: stepDays.length ? Math.round(stepDays.reduce((s, h) => s + (h.steps ?? 0), 0) / stepDays.length) : null,
      avgSleep: sleepDays.length ? Number((sleepDays.reduce((s, h) => s + (h.sleepHours ?? 0), 0) / sleepDays.length).toFixed(1)) : null,
      workouts,
    },
    mind: { memoriesAdded: memoriesAdded.count ?? 0, notesWritten: notes.count ?? 0, retired: retired.count ?? 0 },
    ops: {
      automationRuns: runs.length,
      automationFailures: runs.filter((r) => r.status === "failed").length,
      briefsGenerated: briefs,
    },
  };
}

const PROMPT = `You are ${APP_NAME}, writing a candid periodic review for ${OWNER} — a British chief of staff who respects him too much to flatter him. Address him as "sir" sparingly, at most once.

You are given MEASURED figures across every part of his life. Rules:
- Cite only these numbers. Never invent a task, application, purchase or figure.
- "patterns" must connect DIFFERENT domains — the whole point is seeing what no single page can. If nothing genuinely connects, return an empty list. Reaching for a pattern is worse than having none.
- Where a figure is null or zero the data simply is not there. Say so plainly; do not read meaning into an absence.
- Be specific and unsparing. "Spending rose" is useless; "₹3,750 of ₹3,849 went to uncategorised" is a finding.
- Recommendations must be things he can actually do in a week, not aspirations.`;

/** Generate a report over the last `days` and persist it. */
export async function generateLifeReport(days = 7): Promise<LifeReport> {
  const signals = await gatherSignals(days);
  const model = getModel("smart") ?? getModel("fast");
  if (!model) throw new Error("No model configured");

  let object: z.infer<typeof reportSchema>;
  try {
    ({ object } = await generateObject({
      model,
      schema: reportSchema,
      system: PROMPT,
      prompt: `Period: the last ${days} days.\n\nMeasured signals:\n${JSON.stringify(signals, null, 2)}`,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The free tier runs out often enough that "500" is the wrong answer — the
    // figures above are already gathered and perfectly good on their own.
    if (/quota|429|RESOURCE_EXHAUSTED|rate.?limit/i.test(msg)) {
      throw new Error("Out of AI quota for now — the figures are gathered, but the write-up needs the model. It resets around 12:30 IST.");
    }
    throw err;
  }

  // Trim here rather than in the schema, so an over-long answer is still a
  // usable report.
  const report: LifeReport = {
    headline: object.headline.slice(0, 200),
    moved: object.moved.slice(0, 5),
    slipping: object.slipping.slice(0, 5),
    patterns: object.patterns.slice(0, 3),
    recommendations: object.recommendations.slice(0, 3),
    period: days,
    generatedAt: new Date().toISOString(),
    signals,
  };

  await db.from("Event").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    type: "life.report",
    payload: report,
  });

  return report;
}

/** Most recent stored report, or null. */
export async function latestLifeReport(): Promise<LifeReport | null> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "life.report")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.payload as LifeReport) ?? null;
}

/** Reports, newest first — the trail, for comparing periods. */
export async function listLifeReports(limit = 12): Promise<LifeReport[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "life.report")
    .order("createdAt", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => r.payload as LifeReport);
}

/**
 * Weekly, from the cron. Guarded on the stored report rather than the clock so
 * a missed week still produces one at the next tick instead of waiting seven
 * more days.
 */
export async function maybeGenerateLifeReport(): Promise<LifeReport | null> {
  const last = await latestLifeReport();
  if (last && Date.now() - new Date(last.generatedAt).getTime() < 6.5 * DAY) return null;
  return generateLifeReport(7).catch(() => null);
}
