import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { embedText, toVectorLiteral } from "@/infrastructure/embeddings";
import { within } from "@/lib/budget";

export interface RecalledMemory {
  id: string;
  type: string;
  content: string;
  importance: number;
  confidence: number;
  similarity?: number;
}

/**
 * Rank by more than raw similarity.
 *
 * Cosine distance alone treats a low-confidence guess from March exactly like
 * a fact you stated yourself and SAGE has leaned on weekly. Importance and
 * confidence are already stored per memory and were going unused at recall
 * time; folding them in costs nothing and puts the better-evidenced memory
 * first when two are equally on-topic.
 */
function score(m: RecalledMemory): number {
  const sim = m.similarity ?? 0.5;
  return sim * 0.7 + m.importance * 0.2 + m.confidence * 0.1;
}

/**
 * Semantic recall via the match_memories RPC (pgvector ANN). Falls back to
 * importance/recency ranking when embeddings or the RPC are unavailable.
 */
/**
 * How long recall may hold up a reply.
 *
 * Recall sits in front of the model call — nothing streams until it returns —
 * so its latency is dead air on every single message. With the vector index in
 * place it comes back in tens of milliseconds; this exists for when it does
 * not: a cold Supabase connection, a slow embedding call, a network hiccup.
 *
 * Answering a second later with everything remembered is worse than answering
 * now with slightly less context, because the memory block is an enrichment,
 * not a precondition — SAGE is told to say it does not know rather than invent,
 * so a thin recall degrades honestly instead of wrongly.
 */
const RECALL_DEADLINE_MS = 1200;

/** Whatever recall produced by the deadline, or nothing. Never throws. */
export async function recallWithin(query: string, limit = 8, ms = RECALL_DEADLINE_MS): Promise<RecalledMemory[]> {
  return within(recallMemories(query, limit), ms, [] as RecalledMemory[]);
}

/**
 * Record that these memories were used.
 *
 * The touch_memories RPC has shipped since 0002 and nothing has ever called
 * it, so accessCount stayed 0 on every row and the memory page said "never
 * recalled" beside all of them — including the ones SAGE reaches for daily.
 * That is not a display bug: the number was correct, it was simply never
 * written, so consolidation's own "has this ever been touched?" test could
 * only ever answer no, and it decided what to retire on that basis.
 *
 * Not awaited. Recall sits in front of the model call and nothing streams
 * until it returns; bookkeeping must not add a round trip to that path, and
 * a failed bump is worth nothing to recover.
 */
function touch(ids: string[]): void {
  if (!ids.length) return;
  void db.rpc("touch_memories", { p_ids: ids }).then(({ error }) => {
    if (error) console.warn("[memory] touch failed:", error.message);
  });
}

export async function recallMemories(query: string, limit = 8): Promise<RecalledMemory[]> {
  const embedding = await embedText(query).catch(() => null);

  if (embedding) {
    const { data, error } = await db.rpc("match_memories", {
      query_embedding: toVectorLiteral(embedding),
      match_count: Math.max(limit * 2, 12),
      p_user_id: DEFAULT_USER_ID,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      // Over-fetch, then re-rank, so the weighting can actually change the
      // order rather than just shuffling whatever the ANN already returned.
      const top = (data as RecalledMemory[]).sort((a, b) => score(b) - score(a)).slice(0, limit);
      touch(top.map((m) => m.id));
      return top;
    }
  }

  const { data } = await db
    .from("Memory")
    .select("id, type, content, importance, confidence")
    .eq("userId", DEFAULT_USER_ID)
    .is("supersededBy", null)
    // Consolidation retires expired memories once a day; this keeps one that
    // lapsed since then out of the prompt in the meantime.
    .or(`expiresAt.is.null,expiresAt.gt.${new Date().toISOString()}`)
    .order("importance", { ascending: false })
    .order("createdAt", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as RecalledMemory[];
  touch(rows.map((m) => m.id));
  return rows;
}

/** Render recalled memories as a system-prompt block; empty string if none. */
export function renderMemoryBlock(memories: RecalledMemory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m) => `- [${m.type}] ${m.content}`);
  return `\n\nWhat you know about the user (long-term memory — use naturally, never recite as a list):\n${lines.join("\n")}`;
}

/** Mark memories as used so consolidation can favor them. */
export async function touchMemories(ids: string[]) {
  if (ids.length === 0) return;
  await db.rpc("touch_memories", { p_ids: ids }).then(
    () => undefined,
    () => undefined, // RPC optional; recall still works without it
  );
}
