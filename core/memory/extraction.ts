import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { embedText, toVectorLiteral } from "@/infrastructure/embeddings";
import { TZ } from "@/lib/config";

const extractionSchema = z.object({
  memories: z.array(
    z.object({
      type: z.enum(["fact", "preference", "goal", "routine", "skill", "relationship", "episode"]),
      content: z.string().describe("One self-contained sentence about the user, in third person"),
      confidence: z.number().min(0).max(1),
      /**
       * How long this is true for.
       *
       * Everything was stored as a permanent fact, so "I'm in Bangalore this
       * week" and "I live in Bangalore" became the same kind of row, and the
       * first one was still being recalled as current months later. A memory
       * that was true once and is asserted forever is worse than no memory:
       * it is recalled with the same confidence as a real fact and quietly
       * makes the answer wrong.
       */
      lastsDays: z
        .number()
        .int()
        .positive()
        .nullable()
        .describe("Days this stays true, or null when it is a lasting fact about the user"),
    }),
  ),
});

/** Words that make a sentence meaningless once the day it was said has passed. */
const RELATIVE = /\b(today|tonight|tomorrow|yesterday|this (morning|afternoon|evening|week|month)|next (week|month|year)|last (week|month|night|year)|in (a few|two|three) (days|weeks)|currently|right now|at the moment)\b/i;

const EXTRACTION_PROMPT = `You extract long-term memories about the user from a conversation exchange.
Only extract things worth remembering for months: stable facts, preferences, goals, routines, skills, relationships, or significant decisions (episodes).
Do NOT extract: small talk, one-off questions, anything the assistant said about itself, or sensitive attributes (health, politics, religion) unless the user explicitly asks to track them.
Return an empty list when nothing qualifies — most exchanges contain nothing worth remembering.

Write every memory so it is still true and still legible a year from now:
- Never use relative time words — no "today", "tomorrow", "this week", "currently", "right now". A memory is read back on an unknown future date, so "he has a deadline tomorrow" is wrong every day but one. Write the absolute date instead.
- Set lastsDays when the thing has an end: a trip, a deadline, a temporary arrangement, anything phrased as "for now". Use null only for something that will still be true in a year.
- Today's date is given below; use it to turn any relative reference into a real one.`;

/**
 * Post-exchange memory extraction (fire-and-forget from the chat route).
 * Dedupes against existing memories via semantic similarity when available.
 */
export async function extractMemories(userText: string, assistantText: string) {
  const model = getModel("fast");
  if (!model) return;

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const { object } = await generateObject({
    model,
    schema: extractionSchema,
    system: EXTRACTION_PROMPT,
    prompt: `Today is ${today}.\n\nUser said:\n${userText}\n\nAssistant replied:\n${assistantText.slice(0, 2000)}`,
  });

  for (const memory of object.memories) {
    if (memory.confidence < 0.5) continue;

    /*
     * The instruction is not enough on its own.
     *
     * A model told not to write "tomorrow" still does, and the row it writes
     * outlives the day it meant. A relative reference with no expiry is the
     * one combination that cannot be salvaged later — there is no way to work
     * out afterwards which day "tomorrow" was — so it is dropped rather than
     * stored as a fact that will be quietly wrong from the next morning on.
     */
    if (RELATIVE.test(memory.content) && memory.lastsDays == null) continue;

    const expiresAt = memory.lastsDays == null
      ? null
      : new Date(Date.now() + memory.lastsDays * 86_400_000).toISOString();

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
      // Recall and consolidation both already filter on this; nothing had ever
      // written it, so no memory could expire.
      expiresAt,
      ...(embedding ? { embedding: toVectorLiteral(embedding) } : {}),
    });
  }
}
