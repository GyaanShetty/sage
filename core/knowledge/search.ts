import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { embedText, toVectorLiteral } from "@/infrastructure/embeddings";

export interface KnowledgeHit {
  id: string;
  sourceId: string;
  sourceTitle: string;
  content: string;
  similarity: number;
}

/** Semantic search over ingested knowledge via the match_chunks RPC. */
export async function searchKnowledge(query: string, limit = 6): Promise<KnowledgeHit[]> {
  const embedding = await embedText(query).catch(() => null);
  if (!embedding) return [];
  const { data, error } = await db.rpc("match_chunks", {
    query_embedding: toVectorLiteral(embedding),
    match_count: limit,
    p_user_id: DEFAULT_USER_ID,
  });
  if (error) {
    console.error("[knowledge] match_chunks failed:", error.message);
    return [];
  }
  return (data ?? []) as KnowledgeHit[];
}
