import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { OWNER } from "@/lib/config";

/**
 * Coaching, not solving.
 *
 * A model will happily write the whole solution, and that is precisely the
 * thing that makes practising useless — you get the green tick and learn
 * nothing. So the levels are explicit and the model is told, in each one, what
 * it may not say. Only the last level shows code, and it is a decision you
 * have to make deliberately.
 *
 * The distinction matters most on the middle level: naming the technique
 * ("this is a sliding window") is a genuine unblock, whereas writing the loop
 * is doing the exercise for you.
 */

const TYPE = "coding.attempt";

export const HELP_LEVELS = ["nudge", "approach", "review", "solution"] as const;
export type HelpLevel = (typeof HELP_LEVELS)[number];

export const LEVEL_META: Record<HelpLevel, { label: string; hint: string }> = {
  nudge: { label: "Nudge", hint: "One question to unstick you. No technique named." },
  approach: { label: "Approach", hint: "The technique and why it fits. Still no code." },
  review: { label: "Review my code", hint: "What is wrong with what you have written." },
  solution: { label: "Show a solution", hint: "The full answer, with the reasoning." },
};

const schema = z.object({
  response: z.string().describe("The coaching itself, in markdown. Follow the level's rules exactly."),
  /** Only ever populated at the solution level. */
  code: z.string().describe("Complete solution code, or an empty string at every level except 'solution'"),
  complexity: z.string().describe("Time and space complexity of the approach discussed, e.g. 'O(n) time, O(1) space'. Empty if not yet determined."),
});

const RULES: Record<HelpLevel, string> = {
  nudge:
    "Ask ONE question that gets him unstuck, and stop. Do not name the technique, do not describe the algorithm, do not write code. " +
    "If his code is close, point at the line that is wrong without saying why.",
  approach:
    "Name the technique and explain why it fits this problem's constraints. Describe the steps in prose. " +
    "Write NO code — not even pseudocode with syntax. He implements it.",
  review:
    "Review the code he has written. Say what is wrong, and why it is wrong, and what the failing case looks like. " +
    "Do not rewrite it for him — describe the fix in words so he makes the edit.",
  solution:
    "Give the complete solution with the reasoning behind it, then the code. Explain the complexity honestly, " +
    "including where it is worse than optimal.",
};

export interface Coaching extends z.infer<typeof schema> {
  level: HelpLevel;
}

export async function coach(input: {
  level: HelpLevel;
  title: string;
  statement: string;
  language: string;
  code: string;
  runOutput?: string;
}): Promise<Coaching | { error: string }> {
  const model = getModel("smart") ?? getModel("fast");
  if (!model) return { error: "No model available right now." };

  const level = HELP_LEVELS.includes(input.level) ? input.level : "nudge";

  try {
    const { object } = await generateObject({
      model,
      schema,
      system:
        `You are SAGE, coaching ${OWNER} through a coding problem. He is practising, so solving it for him ` +
        "is a disservice — the green tick is worthless if he did not get there.\n\n" +
        `LEVEL: ${level}. ${RULES[level]}\n\n` +
        (level === "solution" ? "" : "The `code` field MUST be an empty string at this level.\n") +
        "Be direct. No praise, no 'great question', no restating the problem back at him.",
      prompt: [
        `Problem: ${input.title}`,
        `Statement:\n${input.statement.slice(0, 4000)}`,
        `Language: ${input.language}`,
        input.code.trim() ? `His code so far:\n\`\`\`\n${input.code.slice(0, 6000)}\n\`\`\`` : "He has not written anything yet.",
        input.runOutput ? `Last run output:\n${input.runOutput.slice(0, 1500)}` : "",
      ].filter(Boolean).join("\n\n"),
    });

    return {
      ...object,
      // Belt and braces: the instruction above is usually obeyed, but a
      // solution leaking through at "nudge" would defeat the entire point of
      // having levels, so it is enforced here as well as asked for.
      code: level === "solution" ? object.code : "",
      level,
    };
  } catch {
    return { error: "The model couldn't help with that one — try again." };
  }
}

export interface Attempt {
  id: string;
  slug: string;
  title: string;
  language: string;
  code: string;
  at: string;
  /** Whether the last run exited cleanly. Not a LeetCode verdict. */
  ran: boolean;
  helpUsed: HelpLevel[];
}

/** Keep the work. A solve you cannot look back at teaches you once. */
export async function saveAttempt(a: Omit<Attempt, "id" | "at">): Promise<string> {
  const id = crypto.randomUUID();
  await db.from("Event").insert({
    id, userId: DEFAULT_USER_ID, type: TYPE,
    payload: { ...a, at: new Date().toISOString(), code: a.code.slice(0, 20_000) },
  });
  return id;
}

export async function listAttempts(slug?: string, limit = 20): Promise<Attempt[]> {
  let q = db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE);
  if (slug) q = q.eq("payload->>slug", slug);

  const { data } = await q.order("createdAt", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Attempt, "id">) }));
}
