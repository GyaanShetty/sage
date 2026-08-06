import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { HUMAN_RULES } from "@/lib/config";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { schedule } from "@/core/retention/cards";

/**
 * The Feynman loop.
 *
 * Flashcards test whether you can recognise an answer. That is a much lower
 * bar than being able to produce one, and a far lower bar again than being
 * able to explain the thing to someone who does not already know it — which is
 * the only test that reliably catches the gap between "I have read this twice"
 * and "I understand this".
 *
 * So: mark a concept you do not understand, and it comes back. When it does,
 * you explain it out loud in your own words, and the explanation is graded
 * against the source you saved with it — not against a model's general
 * knowledge, which would let it mark you down for disagreeing with a textbook
 * it has never seen, and mark you up for fluent nonsense that happens to sound
 * like the literature.
 *
 * The grade drives spacing through the same SM-2 code the flashcards use.
 * There is no reason for this to have its own scheduler, and two schedulers
 * would be two things to get wrong.
 */

const TYPE = "feynman.concept";

export interface Attempt {
  at: string;
  /** What he said, verbatim. The point is to be able to reread it later. */
  explanation: string;
  score: number;
  missed: string[];
  wrong: string[];
  probe: string;
}

export interface Concept {
  id: string;
  title: string;
  /** The material to be graded against. Pasted text, or notes he trusts. */
  source: string;
  sourceUrl?: string;
  /** Optional link back to a skill, so the education page can group them. */
  skillId?: string;
  attempts: Attempt[];
  /** SM-2 state, shared with the flashcards. */
  ease: number;
  interval: number;
  reps: number;
  dueAt: string;
  at: string;
  /** Set when he stops wanting it back, so it leaves the rotation. */
  retiredAt?: string | null;
}

/**
 * Score → SM-2 grade.
 *
 * The 0-100 score is what a grader can express; SM-2 wants 0-5. Mapped so that
 * anything under 60 counts as a lapse, because an explanation with a real hole
 * in it should come back tomorrow, not in a fortnight.
 */
export function gradeFromScore(score: number): number {
  const s = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
  if (s >= 92) return 5;
  if (s >= 80) return 4;
  if (s >= 60) return 3;
  if (s >= 40) return 2;
  if (s >= 20) return 1;
  return 0;
}

/** Where he is with a concept, in words rather than a number. */
export function standing(c: Pick<Concept, "attempts" | "reps">): string {
  const last = c.attempts.at(-1);
  if (!last) return "Not attempted yet.";
  if (c.attempts.length === 1) return `First go: ${last.score}%. One attempt says very little.`;
  const first = c.attempts[0].score;
  const delta = last.score - first;
  const move = delta > 8 ? `up ${delta} from your first` : delta < -8 ? `down ${Math.abs(delta)} from your first` : "flat against your first";
  return `${last.score}% across ${c.attempts.length} attempts, ${move}.`;
}

/** Concepts he owes an explanation, oldest due first. */
export function dueOf(concepts: Concept[], now = new Date()): Concept[] {
  return concepts
    .filter((c) => !c.retiredAt && new Date(c.dueAt).getTime() <= now.getTime())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

// ── store ──────────────────────────────────────────────────────────────────

export async function listConcepts(limit = 200): Promise<Concept[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ ...(r.payload as Omit<Concept, "id">), id: r.id as string }));
}

export async function addConcept(input: {
  title: string; source: string; sourceUrl?: string; skillId?: string;
}): Promise<string | null> {
  if (!input.title.trim() || !input.source.trim()) return null;
  const id = crypto.randomUUID();
  const concept: Omit<Concept, "id"> = {
    title: input.title.trim().slice(0, 200),
    source: input.source.trim().slice(0, 20_000),
    ...(input.sourceUrl?.trim() ? { sourceUrl: input.sourceUrl.trim().slice(0, 500) } : {}),
    ...(input.skillId ? { skillId: input.skillId } : {}),
    attempts: [],
    ease: 2.5,
    interval: 0,
    reps: 0,
    // Due immediately: he marked it because he does not understand it.
    dueAt: new Date().toISOString(),
    at: new Date().toISOString(),
    retiredAt: null,
  };
  await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: TYPE, payload: concept });
  return id;
}

export async function retireConcept(id: string, retired = true): Promise<void> {
  const { data } = await db.from("Event").select("payload").eq("id", id).eq("userId", DEFAULT_USER_ID).maybeSingle();
  if (!data) return;
  await db.from("Event")
    .update({ payload: { ...(data.payload as object), retiredAt: retired ? new Date().toISOString() : null } })
    .eq("id", id);
}

export async function deleteConcept(id: string): Promise<void> {
  const { trashRow } = await import("@/core/ops/trash");
  await trashRow("Event", id);
}

// ── grading ────────────────────────────────────────────────────────────────

const gradeSchema = z.object({
  score: z.number().describe("0-100, how completely and correctly the explanation covers the source"),
  missed: z.array(z.string()).describe("Points in the source the explanation left out entirely"),
  wrong: z.array(z.string()).describe("Things the explanation states that the source contradicts"),
  probe: z.string().describe("One question that would expose the biggest remaining gap"),
});

const SYSTEM =
  `You are marking Gyaan's explanation of something he is trying to learn. ${HUMAN_RULES} ` +
  "Grade the explanation ONLY against the source material given to you. If the source does not " +
  "cover something, its absence from his explanation is not a miss, and his claim about it is not " +
  "wrong — say nothing about it either way.\n" +
  "Judge understanding, not vocabulary. An explanation in plain words that gets the mechanism right " +
  "beats one that uses the correct terms in the wrong relationships — the second is the failure mode " +
  "this whole exercise exists to catch, so mark it down hard.\n" +
  "Be specific in `missed` and `wrong`: name the thing, do not say 'more detail needed'. " +
  "The probe should be answerable from the source and should target the largest gap.";

export interface GradeResult { attempt: Attempt; dueAt: string; concept: Concept }

/** Grade one explanation and reschedule the concept. */
export async function gradeExplanation(id: string, explanation: string): Promise<GradeResult | { error: string }> {
  const clean = explanation.trim();
  if (clean.length < 20) return { error: "That is too short to grade. Explain it as if to someone who has not read it." };

  const { data } = await db.from("Event").select("payload").eq("id", id).eq("userId", DEFAULT_USER_ID).maybeSingle();
  if (!data) return { error: "That concept is gone." };
  const prev = data.payload as Omit<Concept, "id">;

  const model = getModel("smart") ?? getModel("fast");
  if (!model) return { error: "No model available right now." };

  let graded: z.infer<typeof gradeSchema>;
  try {
    const { object } = await generateObject({
      model,
      schema: gradeSchema,
      system: SYSTEM,
      prompt:
        `Concept: ${prev.title}\n\n── The source ──\n${prev.source.slice(0, 12_000)}\n\n` +
        `── His explanation ──\n${clean.slice(0, 6000)}`,
    });
    graded = object;
  } catch (e) {
    return { error: `Couldn't grade that: ${(e as Error).message.slice(0, 140)}` };
  }

  const score = Math.min(100, Math.max(0, Math.round(graded.score)));
  const attempt: Attempt = {
    at: new Date().toISOString(),
    explanation: clean.slice(0, 8000),
    score,
    missed: graded.missed.slice(0, 8),
    wrong: graded.wrong.slice(0, 8),
    probe: graded.probe.slice(0, 400),
  };

  const next = schedule(prev, gradeFromScore(score));
  const dueAt = new Date(Date.now() + next.dueInDays * 86_400_000).toISOString();
  const payload: Omit<Concept, "id"> = {
    ...prev,
    // Attempts are kept whole — the trail is the point, and rereading a bad
    // early explanation next to a good later one is most of the value.
    attempts: [...(prev.attempts ?? []), attempt].slice(-30),
    ease: next.ease, interval: next.interval, reps: next.reps, dueAt,
  };

  await db.from("Event").update({ payload }).eq("id", id);
  return { attempt, dueAt, concept: { ...payload, id } };
}
