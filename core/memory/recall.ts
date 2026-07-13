import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { embedText, toVectorLiteral } from "@/infrastructure/embeddings";

export interface RecalledMemory {
  id: string;
  type: string;
  content: string;
  importance: number;
  confidence: number;
  similarity?: number;
}

/**
 * Semantic recall via the match_memories RPC (pgvector ANN). Falls back to
 * importance/recency ranking when embeddings or the RPC are unavailable.
 */
export async function recallMemories(query: string, limit = 8): Promise<RecalledMemory[]> {
  const embedding = await embedText(query).catch(() => null);

  if (embedding) {
    const { data, error } = await db.rpc("match_memories", {
      query_embedding: toVectorLiteral(embedding),
      match_count: limit,
      p_user_id: DEFAULT_USER_ID,
    });
    if (!error && Array.isArray(data) && data.length > 0) return data as RecalledMemory[];
  }

  const { data } = await db
    .from("Memory")
    .select("id, type, content, importance, confidence")
    .eq("userId", DEFAULT_USER_ID)
    .is("supersededBy", null)
    .order("importance", { ascending: false })
    .order("createdAt", { ascending: false })
    .limit(limit);
  return (data ?? []) as RecalledMemory[];
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
