import { generateText, stepCountIs } from "ai";
import { getModel } from "@/infrastructure/llm";
import { nativeTools } from "@/core/tools/native";
import { planningTools } from "@/core/tools/planning";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { APP_NAME } from "@/lib/config";

export interface AutomationRow {
  id: string;
  name: string;
  trigger: { type: "daily"; time?: string };
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
  let ran = 0;
  const now = new Date();
  for (const automation of (data ?? []) as AutomationRow[]) {
    if (automation.trigger?.type !== "daily") continue;
    const [h, m] = (automation.trigger.time ?? "08:00").split(":").map(Number);
    const scheduledToday = new Date(now);
    scheduledToday.setUTCHours(h, m, 0, 0);
    const last = automation.lastRunAt ? new Date(automation.lastRunAt) : null;
    if (now >= scheduledToday && (!last || last < scheduledToday)) {
      await runAutomation(automation).catch(() => undefined);
      ran += 1;
    }
  }
  return ran;
}
