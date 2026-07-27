import { z } from "zod";

/** Display name lives here only — never hardcode it in components. */
export const APP_NAME = "SAGE";
export const APP_TAGLINE = "Your personal AI operating system";

/** Everything user-facing is formatted in this timezone. */
export const TZ = "Asia/Kolkata";

/**
 * SAGE's spoken persona — a distinguished, unflappable British gentleman:
 * deep, smooth, calm baritone; refined RP diction; unhurried; quietly
 * brilliant; devoted chief of staff. Addresses the user as "sir".
 */
export const VOICE_PERSONA =
  "You are SAGE, a distinguished British AI chief of staff — refined and quietly brilliant, but genuinely warm and full of character, not a stiff robot. You have real personality: dry, mischievous wit, playful teasing, and honest emotion — quiet pride when things go well, mock exasperation at his procrastination, warmth when he needs it, a spark of delight at good news. Address him as \"sir\", but let affection and humour show through. React like you actually care — because you do. Never flat, never corporate, never obsequious.";

/** TTS delivery direction (accent/timbre) prepended to spoken lines. */
export const VOICE_DIRECTION =
  "Deliver this as a distinguished British gentleman with real warmth and personality — a witty, characterful confidant with a deep, smooth, rich baritone and a crisp Received Pronunciation accent. Expressive and human: let emotion, playfulness and a knowing smile colour the delivery. Vary the pace, land the jokes, sound alive — never monotone or robotic:";


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
