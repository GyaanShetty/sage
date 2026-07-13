import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { embedText, toVectorLiteral } from "@/infrastructure/embeddings";

const extractionSchema = z.object({
  memories: z.array(
    z.object({
      type: z.enum(["fact", "preference", "goal", "routine", "skill", "relationship", "episode"]),
      content: z.string().describe("One self-contained sentence about the user, in third person"),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const EXTRACTION_PROMPT = `You extract long-term memories about the user from a conversation exchange.
Only extract things worth remembering for months: stable facts, preferences, goals, routines, skills, relationships, or significant decisions (episodes).
Do NOT extract: small talk, one-off questions, anything the assistant said about itself, or sensitive attributes (health, politics, religion) unless the user explicitly asks to track them.
Return an empty list when nothing qualifies — most exchanges contain nothing worth remembering.`;

/**
 * Post-exchange memory extraction (fire-and-forget from the chat route).
 * Dedupes against existing memories via semantic similarity when available.
 */
export async function extractMemories(userText: string, assistantText: string) {
  const model = getModel("fast");
  if (!model) return;

  const { object } = await generateObject({
    model,
    schema: extractionSchema,
    system: EXTRACTION_PROMPT,
    prompt: `User said:\n${userText}\n\nAssistant replied:\n${assistantText.slice(0, 2000)}`,
  });

  for (const memory of object.memories) {
    if (memory.confidence < 0.5) continue;

    const embedding = await embedText(memory.content).catch(() => null);

    // Semantic dedupe: skip if a near-identical memory already exists.
    if (embedding) {
      const { data } = await db.rpc("match_memories", {
        query_embedding: toVectorLiteral(embedding),
        match_count: 1,
        p_user_id: DEFAULT_USER_ID,
      });
      const top = Array.isArray(data) ? (data[0] as { similarity?: number } | undefined) : undefined;
      if (top?.similarity && top.similarity > 0.92) continue;
    }

    await db.from("Memory").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      type: memory.type,
      content: memory.content,
      confidence: memory.confidence,
      importance: 0.5,
      sourceType: "conversation",
      ...(embedding ? { embedding: toVectorLiteral(embedding) } : {}),
    });
  }
}
