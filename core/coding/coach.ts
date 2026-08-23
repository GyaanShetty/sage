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

/**
 * LeetCode's own language slugs, and what to call them in a prompt.
 *
 * The slug was being handed to the model verbatim — "Language: golang" — as a
 * single line in the middle of the user prompt. Models default to Python for
 * competitive-programming problems, and a label that weak never overcame it,
 * which is why every solution came back in Python whatever the picker said.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  python3: "Python 3",
  cpp: "C++",
  java: "Java",
  javascript: "JavaScript",
  typescript: "TypeScript",
  golang: "Go",
  rust: "Rust",
  c: "C",
  csharp: "C#",
  ruby: "Ruby",
  swift: "Swift",
  kotlin: "Kotlin",
  scala: "Scala",
  php: "PHP",
};

export function languageName(key: string): string {
  return LANGUAGE_NAMES[key] ?? key;
}

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
  const lang = languageName(input.language);

  // Without a statement there is nothing to be accurate against, and the model
  // would answer from memory — confidently, and often about a different
  // revision of the problem. Refusing is the honest answer.
  if (!input.statement.trim()) {
    return { error: "The problem statement did not load, so I would only be recalling it. Reload the problem." };
  }

  try {
    const { object } = await generateObject({
      model,
      schema,
      system:
        `You are SAGE, coaching ${OWNER} through a coding problem. He is practising, so solving it for him ` +
        "is a disservice — the green tick is worthless if he did not get there.\n\n" +
        `LEVEL: ${level}. ${RULES[level]}\n\n` +
        (level === "solution" ? "" : "The `code` field MUST be an empty string at this level.\n") +
        // Stated here, in the system prompt, and stated as a rule rather than
        // as a fact. As one line of context it lost every time to the model's
        // habit of answering LeetCode in Python.
        `LANGUAGE: write every line of code in ${lang}. This is not a preference — code in any ` +
        `other language is a wrong answer, however correct the algorithm. Idioms, standard library ` +
        `and naming conventions should be ${lang}'s own, not a transliteration of Python.\n\n` +
        /**
         * Grounding.
         *
         * The statement below is fetched from LeetCode. Without this the model
         * answers from its memory of a problem with the same name, which is
         * where the wrong constraints and invented examples came from — most
         * damagingly when the two nearly agree, because then it looks right.
         */
        "ACCURACY: the statement below is the problem, and the only source for it. Do not use " +
        "anything you remember about a problem with this name — recalled constraints, examples or " +
        "follow-ups are frequently wrong or belong to a different revision. Every constraint, " +
        "example and edge case you mention must be traceable to the text you were given. If the " +
        "statement does not say something, say that it does not say, rather than filling it in.\n\n" +
        "Be direct. No praise, no 'great question', no restating the problem back at him.",
      prompt: [
        `Problem: ${input.title}`,
        // 4000 characters cut the longer problems mid-constraints, and a model
        // handed a truncated statement completes it from memory — which is the
        // very thing the accuracy rule above forbids.
        `Statement:\n${input.statement.slice(0, 12_000)}`,
        `Language: ${lang}`,
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
  } catch (err) {
    // Saying why matters here: "try again" is useless advice against a quota
    // that resets tomorrow, and identical advice to an overloaded model that
    // clears in seconds.
    const msg = err instanceof Error ? err.message : String(err);
    if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg)) return { error: "Out of AI quota for now — it resets, or add another key in Settings." };
    if (/high demand|overloaded|503|UNAVAILABLE/i.test(msg)) return { error: "The model is busy. Ask again in a moment." };
    return { error: `The model couldn't help with that one: ${msg.slice(0, 140)}` };
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
