import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * Model tiers per docs/architecture/04. Currently backed by Gemini's free
 * tier; swapping to Claude later means changing only this file.
 * Returns null when no provider key is configured — callers fall back to
 * the built-in mock stream so the app works keyless.
 */
export type ModelTier = "fast" | "smart";

export function getModel(tier: ModelTier = "smart"): LanguageModel | null {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return null;
  return tier === "fast" ? google("gemini-2.5-flash-lite") : google("gemini-2.5-flash");
}
