import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { trashRow } from "@/core/ops/trash";

/**
 * A decision journal, with the scoring left in.
 *
 * Every other page in SAGE records what happened. This one records what he
 * thought was going to happen — the call, the reasoning, and how sure he was —
 * and then comes back later to check. That gap is the whole product: memory
 * quietly rewrites a 55% hunch into "I knew it", and nothing in an ordinary
 * tool ever contradicts it.
 *
 * The output that matters is not the list of decisions. It is the calibration
 * curve: of the things he was 80% sure about, how many happened? For anyone
 * aiming at markets, two years of that is worth more than any dashboard.
 *
 * Three deliberate constraints:
 *
 *   - Confidence is recorded at decision time and can never be edited. A
 *     journal you can revise after the fact measures nothing.
 *   - Review dates are set by him, in advance, and the reminder comes from the
 *     same delivery path as everything else — an unreviewed decision is the
 *     normal failure of this practice, and the heartbeat now makes nagging
 *     possible.
 *   - Scoring is his own call, not an AI's. SAGE can summarise the pattern; it
 *     must not grade the outcome, because it does not know what happened.
 */

const TYPE = "decision.entry";

export const DOMAINS = ["markets", "career", "study", "health", "money", "life"] as const;
export type Domain = (typeof DOMAINS)[number];

export type Outcome = "right" | "wrong" | "mixed" | "too-early";

export interface Decision {
  id: string;
  title: string;
  /** Why — the reasoning as it stood at the time, not as remembered later. */
  reasoning: string;
  /** What he expects to be true by the review date. The thing being scored. */
  expectation: string;
  /** 50-99. Below 50 is the opposite decision with the confidence inverted. */
  confidence: number;
  domain: Domain;
  decidedAt: string;
  reviewAt: string;
  /** What he considered doing instead. The road not taken is half the lesson. */
  alternatives?: string | null;

  // ── Filled in at review ──────────────────────────────────────────────────
  outcome?: Outcome | null;
  whatHappened?: string | null;
  lesson?: string | null;
  reviewedAt?: string | null;
}

export interface DecisionInput {
  title: string;
  reasoning: string;
  expectation: string;
  confidence: number;
  domain: Domain;
  reviewAt: string;
  alternatives?: string;
}

export async function listDecisions(limit = 200): Promise<Decision[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Decision, "id">) }));
}

export async function addDecision(input: DecisionInput): Promise<string> {
  const id = crypto.randomUUID();
  await db.from("Event").insert({
    id, userId: DEFAULT_USER_ID, type: TYPE,
    payload: {
      title: input.title.trim().slice(0, 200),
      reasoning: input.reasoning.trim().slice(0, 4000),
      expectation: input.expectation.trim().slice(0, 1000),
      // Clamped, not rejected: a slider that refuses the number you moved it to
      // is worse than one that quietly keeps it in range.
      confidence: Math.min(99, Math.max(50, Math.round(input.confidence))),
      domain: (DOMAINS as readonly string[]).includes(input.domain) ? input.domain : "life",
      decidedAt: new Date().toISOString(),
      reviewAt: input.reviewAt,
      alternatives: input.alternatives?.trim().slice(0, 1000) ?? null,
      outcome: null, whatHappened: null, lesson: null, reviewedAt: null,
    },
  });
  return id;
}

/**
 * Record how it turned out.
 *
 * Only the review fields are writable. The decision itself — what he thought,
 * and how sure — is fixed at the moment it was made, because a journal whose
 * past can be edited is a record of his current opinion, not his past one.
 */
export async function reviewDecision(
  id: string,
  review: { outcome: Outcome; whatHappened: string; lesson?: string },
): Promise<boolean> {
  const { data } = await db.from("Event").select("payload").eq("id", id).eq("userId", DEFAULT_USER_ID).maybeSingle();
  if (!data) return false;
  const prev = data.payload as Decision;

  await db.from("Event").update({
    payload: {
      ...prev,
      outcome: review.outcome,
      whatHappened: review.whatHappened.trim().slice(0, 2000),
      lesson: review.lesson?.trim().slice(0, 1000) ?? null,
      reviewedAt: new Date().toISOString(),
    },
  }).eq("id", id);
  return true;
}

export async function deleteDecision(id: string): Promise<void> {
  await trashRow("Event", id);
}

/** Decisions whose review date has arrived and that he has not scored yet. */
export function dueForReview(all: Decision[], now = new Date()): Decision[] {
  return all
    .filter((d) => !d.outcome && d.reviewAt && new Date(d.reviewAt) <= now)
    .sort((a, b) => a.reviewAt.localeCompare(b.reviewAt));
}
