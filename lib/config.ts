import { z } from "zod";

/** Display name lives here only — never hardcode it in components. */
export const APP_NAME = "SAGE";
export const APP_TAGLINE = "Your personal AI operating system";

/** Everything user-facing is formatted in this timezone. */
export const TZ = "Asia/Kolkata";

/** Current hour (0-23) in the app timezone. */
export function tzHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(d)) % 24;
}

/** Format a date in the app timezone. */
export function fmt(d: Date | string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts }).format(new Date(d));
}

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
