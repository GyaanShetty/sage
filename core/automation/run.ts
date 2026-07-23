import { generateText, stepCountIs } from "ai";
import { getModel } from "@/infrastructure/llm";
import { nativeTools } from "@/core/tools/native";
import { planningTools } from "@/core/tools/planning";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { APP_NAME } from "@/lib/config";

export interface AutomationRow {
  id: string;
  name: string;
  trigger: { type: "daily" | "condition"; time?: string; when?: string; threshold?: number };
  workflow: { directive: string };
  enabled: boolean;
  lastRunAt: string | null;
}

const DIRECTIVE_PROMPT = `You are ${APP_NAME} running a scheduled automation for the user — no one is watching, act autonomously.
Execute the directive using your tools (tasks, reminders, notes, memory, knowledge, web search, calendar, email).
Finish with a 1-3 sentence report of what you did or found. Never ask questions.`;

/** Execute one automation directive with full tool access; logs the run. */
export async function runAutomation(automation: AutomationRow): Promise<string> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db.from("AutomationRun").insert({ id: runId, automationId: automation.id, status: "running" });

  try {
    const model = getModel("smart");
    if (!model) throw new Error("No model configured");
    const { text } = await generateText({
      model,
      system: DIRECTIVE_PROMPT + `\n\nCurrent datetime: ${new Date().toISOString()}`,
      prompt: automation.workflow.directive,
      tools: { ...nativeTools, ...planningTools },
      stopWhen: stepCountIs(10),
    });

    await db
      .from("AutomationRun")
      .update({ status: "done", log: [{ at: startedAt, report: text }], endedAt: new Date().toISOString() })
      .eq("id", runId);
    await db.from("Automation").update({ lastRunAt: new Date().toISOString() }).eq("id", automation.id);
    await db.from("Event").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      type: "automation.completed",
      payload: { name: automation.name, report: text.slice(0, 500) },
    });
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("AutomationRun")
      .update({ status: "failed", log: [{ at: startedAt, error: message }], endedAt: new Date().toISOString() })
      .eq("id", runId);
    throw err;
  }
}

/** Automations due now: enabled, not yet run since their scheduled time today. */
export async function runDueAutomations(): Promise<number> {
  const { data } = await db
    .from("Automation")
    .select("id, name, trigger, workflow, enabled, lastRunAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("enabled", true);
  const rows = (data ?? []) as AutomationRow[];
  let ran = 0;
  const now = new Date();

  const hasConditions = rows.some((a) => a.trigger?.type === "condition");
  const signals = hasConditions ? await gatherSignals() : null;

  for (const automation of rows) {
    const last = automation.lastRunAt ? new Date(automation.lastRunAt) : null;
    if (automation.trigger?.type === "daily") {
      const [h, m] = (automation.trigger.time ?? "08:00").split(":").map(Number);
      const scheduledToday = new Date(now);
      scheduledToday.setUTCHours(h, m, 0, 0);
      if (now >= scheduledToday && (!last || last < scheduledToday)) {
        await runAutomation(automation).catch(() => undefined);
        ran += 1;
      }
    } else if (automation.trigger?.type === "condition" && signals) {
      // cooldown: don't re-fire a condition automation within 6h
      if (last && now.getTime() - last.getTime() < 6 * 3600e3) continue;
      if (conditionMet(automation.trigger, signals)) {
        await runAutomation(automation).catch(() => undefined);
        ran += 1;
      }
    }
  }
  return ran;
}

interface Signals { overdue: number; aqi: number | null; maxCryptoMove: number; steps: number | null; unread: number }

async function gatherSignals(): Promise<Signals> {
  const { getWeather } = await import("@/infrastructure/weather");
  const { getMarkets } = await import("@/infrastructure/markets");
  const { listUnreadEmails } = await import("@/infrastructure/integrations/google");
  const nowIso = new Date().toISOString();
  const [{ data: tasks }, weather, coins, emails, { data: health }] = await Promise.all([
    db.from("Task").select("dueAt").eq("userId", DEFAULT_USER_ID).neq("status", "done").neq("status", "cancelled").lt("dueAt", nowIso).not("dueAt", "is", null),
    getWeather().catch(() => null),
    getMarkets().catch(() => null),
    listUnreadEmails(5).catch(() => null),
    db.from("Event").select("payload").eq("userId", DEFAULT_USER_ID).eq("type", "health.report").gte("createdAt", new Date(Date.now() - 36 * 3600e3).toISOString()).order("createdAt", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const steps = Number((health?.payload as { steps?: number } | null)?.steps ?? NaN);
  return {
    overdue: (tasks ?? []).length,
    aqi: weather?.aqi ?? null,
    maxCryptoMove: Math.max(0, ...(coins ?? []).map((c) => Math.abs(c.change24h))),
    steps: Number.isNaN(steps) ? null : steps,
    unread: (emails ?? []).length,
  };
}

function conditionMet(t: { when?: string; threshold?: number }, s: Signals): boolean {
  switch (t.when) {
    case "task_overdue": return s.overdue > 0;
    case "aqi_above": return s.aqi != null && s.aqi >= (t.threshold ?? 150);
    case "crypto_move": return s.maxCryptoMove >= (t.threshold ?? 5);
    case "low_steps": return s.steps != null && s.steps < (t.threshold ?? 3000);
    case "unread_email": return s.unread > 0;
    default: return false;
  }
}
