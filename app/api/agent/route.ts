import { NextResponse } from "next/server";
import { generateText, stepCountIs } from "ai";
import { getModel } from "@/infrastructure/llm";
import { nativeTools } from "@/core/tools/native";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const maxDuration = 120;

interface TraceStep { kind: "tool" | "result" | "think"; tool?: string; text: string }

/** SAGE research agent: plans, searches web + your knowledge, writes a report.
 *  Returns the full step trace so the UI can replay the agent "working". */
export async function POST(req: Request) {
  const { task } = (await req.json()) as { task?: string };
  if (!task?.trim()) return NextResponse.json({ ok: false, error: "task required" }, { status: 400 });

  const model = getModel("smart");
  if (!model) return NextResponse.json({ ok: false, error: "No model configured" }, { status: 400 });

  const { web_search, knowledge_search } = nativeTools;

  try {
    const result = await generateText({
      model,
      system:
        "You are SAGE's autonomous research agent. Break the task down, use web_search for current facts and knowledge_search for the user's own saved knowledge, gather what you need across a few steps, then write a clear, well-structured report. Cite source URLs inline. Be concrete and useful.",
      prompt: task,
      tools: { web_search, knowledge_search },
      stopWhen: stepCountIs(6),
    });

    // If the loop spent all steps gathering and never concluded, synthesise
    // the report from everything it collected.
    let report = result.text?.trim() ?? "";
    if (!report) {
      const synth = await generateText({
        model,
        messages: [
          ...result.response.messages,
          { role: "user", content: "Now write the final report for the original task using everything you gathered above. Clear structure, concrete, cite source URLs inline." },
        ],
      });
      report = synth.text?.trim() ?? "";
    }

    // Build a human-readable trace from the model's steps.
    const trace: TraceStep[] = [];
    for (const s of result.steps) {
      const text = (s.text ?? "").trim();
      if (text) trace.push({ kind: "think", text: text.slice(0, 400) });
      for (const tc of s.toolCalls ?? []) {
        const input = JSON.stringify((tc as { input?: unknown }).input ?? {}).slice(0, 160);
        trace.push({ kind: "tool", tool: tc.toolName, text: input });
      }
      for (const tr of s.toolResults ?? []) {
        const out = (tr as { output?: unknown }).output;
        let summary = "";
        if (Array.isArray((out as { results?: unknown[] })?.results)) summary = `${(out as { results: unknown[] }).results.length} results`;
        else summary = JSON.stringify(out ?? {}).slice(0, 160);
        trace.push({ kind: "result", tool: tr.toolName, text: summary });
      }
    }

    /*
     * Persist the run.
     *
     * This was writing kind/input/output — three columns AgentRun does not
     * have. Supabase returns that error rather than throwing it, and both
     * handlers here discard it, so every run since this shipped was silently
     * dropped and the agent page had no history to show. The real columns are
     * agent/goal/result, and endedAt is what makes a finished run
     * distinguishable from one still running.
     */
    db.from("AgentRun").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      agent: "research",
      goal: task,
      status: "done",
      result: { report, trace },
      endedAt: new Date().toISOString(),
    }).then(({ error }) => { if (error) console.warn("[agent] run not saved:", error.message); });
    db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "agent.completed", payload: { task } })
      .then(({ error }) => { if (error) console.warn("[agent] event not logged:", error.message); });

    return NextResponse.json({ ok: true, data: { task, trace, report } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "agent failed";
    const quota = /quota|429|exhausted/i.test(msg);
    return NextResponse.json({ ok: false, error: quota ? "Daily AI quota reached — try again after it resets." : msg }, { status: 500 });
  }
}

/**
 * Past runs.
 *
 * The rows were being written (or rather, attempted) and nothing ever read
 * them, so a page whose whole subject is work the agent has done showed
 * nothing but an input box — and a finished report vanished on refresh unless
 * you remembered to press Save.
 *
 * The trace comes back with the report because the steps are usually where the
 * useful detail is; the list only renders the goal until you open one.
 */
export async function GET() {
  const { data, error } = await db
    .from("AgentRun")
    .select("id, agent, goal, status, result, startedAt, endedAt")
    .eq("userId", DEFAULT_USER_ID)
    .order("startedAt", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: data ?? [] });
}
