import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { HUMAN_RULES, OWNER } from "@/lib/config";
import { listDecisions } from "./store";
import { calibrate } from "./calibration";

/**
 * "I'd advise against that, sir."
 *
 * The thing that made JARVIS staff rather than software was that he pushed
 * back. Every AI feature in SAGE so far helps Gyaan do what he already
 * intended; this one is the only place that tries to talk him out of it.
 *
 * It runs before a decision is journaled, not after — an objection raised once
 * the call is made is a post-mortem, and post-mortems change nothing.
 *
 * Two things keep it honest rather than contrarian:
 *
 *   - It argues from his own record. "You are twenty points overconfident on
 *     markets across fourteen scored calls" is an argument; "have you
 *     considered the risks?" is a horoscope.
 *   - It is allowed to concede. A model asked to find objections will always
 *     find objections, so it is explicitly permitted — and instructed — to say
 *     the reasoning holds, and to suggest no change to the confidence when
 *     none is warranted. An advocate that objects every time is noise with a
 *     serious face.
 */

export interface AdvocateInput {
  title: string;
  reasoning: string;
  expectation: string;
  confidence: number;
  domain: string;
  alternatives?: string;
}

const schema = z.object({
  verdict: z.enum(["push-back", "sharpen", "concede"]).describe(
    "push-back if the reasoning has a real hole; sharpen if it holds but the expectation is too vague to score; concede if it is sound",
  ),
  strongestCase: z.string().describe("The best argument against, stated as someone who believes it would state it. Empty if conceding."),
  blindSpot: z.string().describe("What his reasoning does not mention at all. Empty if there is nothing."),
  wouldFalsify: z.string().describe("The single observation that would most cleanly show him wrong, and when he could see it"),
  suggestedConfidence: z.number().min(50).max(99).describe("Where the confidence should sit given his record. Same as his if no change is warranted."),
  why: z.string().describe("One sentence on the confidence suggestion, referring to his track record when relevant"),
});

export type Advocacy = z.infer<typeof schema> & {
  /** His own number, echoed back so the UI can show the delta. */
  claimed: number;
  /** What the record actually says, when there is enough of it to say anything. */
  record: string | null;
};

export async function argueAgainst(input: AdvocateInput): Promise<Advocacy | { error: string }> {
  const model = getModel("smart") ?? getModel("fast");
  if (!model) return { error: "No model available right now." };

  // His track record, which is the whole reason this is worth more than a
  // generic "consider the downside".
  const all = await listDecisions().catch(() => []);
  const cal = calibrate(all);
  const domainRecord = cal.byDomain.find((d) => d.domain === input.domain);

  let record: string | null = null;
  if (cal.scored >= 8) {
    const bias = cal.overconfidence < -0.05 ? "overconfident" : cal.overconfidence > 0.05 ? "underconfident" : "well calibrated";
    record = `Across ${cal.scored} scored calls he is ${bias}: right ${Math.round(cal.hitRate * 100)}% of the time while claiming ${Math.round(cal.meanConfidence * 100)}%.`;
    if (domainRecord && domainRecord.n >= 5) {
      record += ` In ${input.domain} specifically: ${Math.round(domainRecord.hitRate * 100)}% right across ${domainRecord.n}.`;
    }
  }

  // Recent misses are the sharpest material available — a pattern he has
  // already walked into is a better warning than a hypothetical one.
  const misses = all
    .filter((d) => d.outcome === "wrong" && d.lesson)
    .slice(0, 3)
    .map((d) => `"${d.title}" (claimed ${d.confidence}%) — lesson he drew: ${d.lesson}`)
    .join("\n");

  try {
    const { object } = await generateObject({
      model,
      schema,
      system:
        `You are SAGE, ${OWNER}'s chief of staff, and your job here is to argue against him before he commits. ${HUMAN_RULES} ` +
        "Take the opposing case seriously — state it as someone who believes it would state it, not as a disclaimer. " +
        "Be specific to this decision; anything you could say about any decision is worthless here. " +
        "You are explicitly allowed to concede: if the reasoning is sound, say so and leave the confidence alone. " +
        "Never hedge with 'it depends' or 'consider the risks'. No markdown, no lists.",
      prompt: [
        `His call: ${input.title}`,
        `His reasoning: ${input.reasoning || "(none given)"}`,
        `What he expects: ${input.expectation}`,
        `His confidence: ${input.confidence}%`,
        `Domain: ${input.domain}`,
        input.alternatives ? `What he considered instead: ${input.alternatives}` : "",
        "",
        record ? `His track record: ${record}` : "He has too few scored decisions to judge his calibration — do not invent a pattern.",
        misses ? `\nCalls he got wrong before:\n${misses}` : "",
      ].filter(Boolean).join("\n"),
    });

    return { ...object, claimed: input.confidence, record };
  } catch (e) {
    return { error: `Couldn't put the other case: ${(e as Error).message.slice(0, 120)}` };
  }
}
