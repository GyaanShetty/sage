import { google } from "@ai-sdk/google";
import { embed } from "ai";

export const EMBEDDING_DIM = 1536;

/**
 * Gemini embeddings (free tier), truncated to 1536 dims to match the
 * pgvector columns. Returns null when no key is configured.
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return null;
  const { embedding } = await embed({
    model: google.textEmbedding("gemini-embedding-001"),
    value: text,
    providerOptions: { google: { outputDimensionality: EMBEDDING_DIM } },
  });
  return embedding;
}

/** pgvector accepts its text literal form over PostgREST. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
