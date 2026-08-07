import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { HUMAN_RULES, OWNER } from "@/lib/config";

/**
 * Playing a decision out.
 *
 * "What if I take the Bangalore offer" gets a generic answer from a generic
 * assistant, because a generic assistant does not know what he earns, what he
 * has committed to, what he said he wanted, or what he has already tried. SAGE
 * does. The difference between advice and counsel is entirely in that context.
 *
 * Grounded rather than imagined: the numbers are gathered first and handed
 * over, and the model is told to work with them and to say plainly when the
 * data does not support a conclusion. A simulation that invents a salary is
 * worse than no simulation, because it looks like arithmetic.
 */

export interface SimulationContext {
  budget: string | null;
  commitments: string | null;
  goals: string | null;
  health: string | null;
  record: string | null;
}

const schema = z.object({
  reading: z.string().describe("What this actually comes down to, in 2-3 sentences. Not a summary of the question."),
  ifYouDo: z.array(z.object({
    horizon: z.enum(["weeks", "months", "years"]),
    effect: z.string(),
  })).describe("Concrete consequences of doing it, at each horizon"),
  ifYouDont: z.array(z.string()).describe("What is given up or avoided by not doing it"),
  hinges: z.array(z.string()).describe("The facts the whole thing turns on — the things worth checking before committing"),
  unknowns: z.array(z.string()).describe("What SAGE does not know that would change the answer. Empty if none."),
  lean: z.string().describe("A direct view, with the reason. Not 'it depends' — take a position and say why."),
});

export type Simulation = z.infer<typeof schema> & { question: string; grounded: string[] };

/** What SAGE can actually put behind an answer, gathered before it speaks. */
async function gather(): Promise<SimulationContext> {
  const [budget, commitments, goals, health, record] = await Promise.all([
    (async () => {
      const { getPlan, budgetStatus, currentMonth } = await import("@/core/finance/budget");
      const plan = await getPlan(currentMonth());
      if (!plan) return null;
      const { listExpenses } = await import("@/core/finance/expenses");
      const s = budgetStatus(plan, await listExpenses(60));
      return `Monthly income ₹${plan.income.toLocaleString("en-IN")}, planned spend ₹${s.totalBudget.toLocaleString("en-IN")}, actual so far ₹${s.totalSpent.toLocaleString("en-IN")}, projected ₹${s.projectedTotal.toLocaleString("en-IN")}.`;
    })().catch(() => null),

    (async () => {
      const { upcomingEvents } = await import("@/core/calendar");
      const events = await upcomingEvents(8, 30);
      if (!events.length) return null;
      return events.map((e) => `${e.summary} (${e.start.slice(0, 10)})`).join("; ");
    })().catch(() => null),

    (async () => {
      const { recallWithin } = await import("@/core/memory/recall");
      const memories = await recallWithin("goals ambitions what he wants career plans", 8, 3000);
      return memories.length ? memories.map((m) => m.content).join(" | ") : null;
    })().catch(() => null),

    (async () => {
      const { listDays, getGoals } = await import("@/core/health/store");
      const [days, g] = await Promise.all([listDays(14), getGoals()]);
      const slept = days.filter((d) => d.sleepHours != null);
      if (!slept.length) return null;
      const avg = slept.reduce((a, d) => a + (d.sleepHours as number), 0) / slept.length;
      return `Averaging ${avg.toFixed(1)}h sleep against a ${g.sleepHours}h target over the last fortnight.`;
    })().catch(() => null),

    (async () => {
      const { listDecisions } = await import("@/core/decisions/store");
      const { calibrate } = await import("@/core/decisions/calibration");
      const cal = calibrate(await listDecisions());
      if (cal.scored < 8) return null;
      return `Across ${cal.scored} scored decisions he is right ${Math.round(cal.hitRate * 100)}% of the time while claiming ${Math.round(cal.meanConfidence * 100)}%.`;
    })().catch(() => null),
  ]);

  return { budget, commitments, goals, health, record };
}

export async function simulate(question: string): Promise<Simulation | { error: string }> {
  const clean = question.trim().slice(0, 400);
  if (!clean) return { error: "Nothing to play out." };

  const model = getModel("smart") ?? getModel("fast");
  if (!model) return { error: "No model available right now." };

  const ctx = await gather();
  const grounded = Object.entries(ctx)
    .filter(([, v]) => v)
    .map(([k]) => k);

  try {
    const { object } = await generateObject({
      model,
      schema,
      system:
        `You are SAGE, ${OWNER}'s chief of staff, playing out a decision with him. ${HUMAN_RULES} ` +
        "Work from the facts given below and nothing else — where they run out, say so in unknowns rather than filling the gap. " +
        "Never invent a number he did not give you. Take an actual position in `lean`; a chief of staff who says 'it depends' is furniture. " +
        "Be concrete and unsentimental. No markdown.",
      prompt: [
        `His question: ${clean}`,
        "",
        "What you know about his situation:",
        ctx.budget ? `Money: ${ctx.budget}` : "Money: no budget on file.",
        ctx.commitments ? `Committed in the next month: ${ctx.commitments}` : "Calendar: nothing on file.",
        ctx.goals ? `What he has said he wants: ${ctx.goals}` : "Goals: nothing recorded.",
        ctx.health ? `Health: ${ctx.health}` : "",
        ctx.record ? `His judgement record: ${ctx.record}` : "",
      ].filter(Boolean).join("\n"),
    });

    return { ...object, question: clean, grounded };
  } catch (e) {
    return { error: `Couldn't play that out: ${(e as Error).message.slice(0, 120)}` };
  }
}
