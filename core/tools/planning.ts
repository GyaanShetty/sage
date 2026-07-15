import { tool } from "ai";
import { z } from "zod";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Planning tools: the model narrates its plan through these, the UI renders
 * a live checklist from the tool parts, and AgentRun keeps the audit trail.
 */
export const planningTools = {
  set_plan: tool({
    description:
      "REQUIRED first step for complex requests (3+ distinct actions, or research combined with creating things): declare your plan as short step titles before executing. Do not use for simple single-action requests.",
    inputSchema: z.object({
      goal: z.string().max(200),
      steps: z.array(z.string().max(100)).min(2).max(8),
    }),
    execute: async ({ goal, steps }) => {
      const runId = crypto.randomUUID();
      await db.from("AgentRun").insert({
        id: runId,
        userId: DEFAULT_USER_ID,
        agent: "orchestrator",
        goal,
        plan: { steps: steps.map((title) => ({ title, status: "pending" })) },
      });
      return { ok: true, runId, steps };
    },
  }),

  complete_step: tool({
    description:
      "Mark a plan step finished right after completing it. Pass the runId from set_plan and the 0-based step index.",
    inputSchema: z.object({
      runId: z.string(),
      stepIndex: z.number().int().min(0),
      note: z.string().max(200).optional(),
    }),
    execute: async ({ runId, stepIndex, note }) => {
      const { data } = await db.from("AgentRun").select("plan").eq("id", runId).maybeSingle();
      const plan = (data?.plan ?? { steps: [] }) as { steps: { title: string; status: string }[] };
      if (plan.steps[stepIndex]) plan.steps[stepIndex].status = "done";
      const allDone = plan.steps.every((s) => s.status === "done");
      await db
        .from("AgentRun")
        .update({
          plan,
          ...(allDone ? { status: "done", endedAt: new Date().toISOString() } : {}),
        })
        .eq("id", runId);
      return { ok: true, stepIndex, note, allDone };
    },
  }),

  create_note: tool({
    description:
      "Save a note into the user's workspace (summaries, research findings, drafts). Content is plain text/markdown.",
    inputSchema: z.object({
      title: z.string().max(120),
      content: z.string().max(20000),
    }),
    execute: async ({ title, content }) => {
      const paragraphs = content
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] }));
      const { error } = await db.from("Note").insert({
        id: crypto.randomUUID(),
        userId: DEFAULT_USER_ID,
        kind: "doc",
        title,
        content: { type: "doc", content: paragraphs },
        aiGenerated: true,
        updatedAt: new Date().toISOString(),
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true, title };
    },
  }),
};
