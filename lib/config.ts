import { z } from "zod";

/** Display name lives here only — never hardcode it in components. */
export const APP_NAME = "SAGE";
export const APP_TAGLINE = "Your personal AI operating system";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
});

/**
 * Validated at first import on the server. Keys are optional during Phase 0
 * so the shell runs without any services configured; features that need a
 * key check for it and degrade gracefully.
 */
export const env = envSchema.parse(process.env);
