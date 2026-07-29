import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";

export const maxDuration = 45;

const schema = z.object({
  name: z.string().describe("Short automation name, 2-5 words, Title Case."),
  triggerType: z.enum(["daily", "condition"]),
  time: z
    .string()
    .describe("For daily triggers: HH:MM in UTC (24h). India is UTC+5:30, so 5am IST = 23:30, 9am IST = 03:30, 6pm IST = 12:30."),
  when: z
    .enum(["task_overdue", "aqi_above", "crypto_move", "low_steps", "unread_email"])
    .describe("For condition triggers only: the event that fires it."),
  threshold: z.number().describe("Numeric threshold for aqi_above/crypto_move/low_steps; 0 otherwise."),
  directive: z
    .string()
    .describe(
      "A precise instruction telling SAGE exactly what to do when this fires, phrased as an order. SAGE has full tool access: web search, email read, task/note creation, calendar, markets. Make it concrete and self-contained.",
    ),
});

/**
 * Turn a free-text suggestion (e.g. a 'what to do next' action from the
 * morning synthesis) into a fully-designed, deployed automation. SAGE
 * researches the best trigger + directive, then saves it enabled.
 */
export async function POST(req: Request) {
  const { suggestion } = (await req.json()) as { suggestion?: string };
  if (!suggestion?.trim()) {
    return NextResponse.json({ ok: false, error: "suggestion required" }, { status: 400 });
  }

  const model = getModel("smart") ?? getModel("fast");
  if (!model) return NextResponse.json({ ok: false, error: "no model" }, { status: 400 });

  let designed: z.infer<typeof schema>;
  try {
    const { object } = await generateObject({
      model,
      schema,
      system:
        "You are SAGE, designing a recurring automation for Gyaan from a one-line suggestion. Pick the most useful trigger: prefer a sensible daily time unless the suggestion is clearly event-driven (an email arriving, a task going overdue, a market move). Write a directive that would genuinely accomplish the intent autonomously. Be concrete — no vague verbs.",
      prompt: `Suggestion: "${suggestion.trim()}"\n\nDesign one automation that turns this into ongoing, hands-off help.`,
    });
    designed = object;
  } catch {
    // Fall back to a plain daily automation echoing the suggestion.
    designed = {
      name: suggestion.trim().slice(0, 60),
      triggerType: "daily",
      time: "03:30",
      when: "unread_email",
      threshold: 0,
      directive: suggestion.trim(),
    };
  }

  const trigger =
    designed.triggerType === "condition"
      ? {
          type: "condition" as const,
          when: designed.when,
          ...(["aqi_above", "crypto_move", "low_steps"].includes(designed.when)
            ? { threshold: designed.threshold }
            : {}),
        }
      : { type: "daily" as const, time: /^\d{2}:\d{2}$/.test(designed.time) ? designed.time : "03:30" };

  await ensureDefaultUser();
  const automation = {
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    name: designed.name.slice(0, 80),
    trigger,
    workflow: { directive: designed.directive },
    enabled: true,
  };
  const { error } = await db.from("Automation").insert(automation);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: automation });
}
