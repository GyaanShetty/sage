import { z } from "zod";

/** Display name lives here only — never hardcode it in components. */
export const APP_NAME = "SAGE";
export const APP_TAGLINE = "Your personal AI operating system";

/**
 * Everything user-facing is formatted in this timezone.
 *
 * NEXT_PUBLIC_ deliberately. This file is imported by client components as
 * well as server code, and Next only inlines NEXT_PUBLIC_* into the browser
 * bundle — a plain SAGE_TZ would be the configured zone on the server and
 * silently the default in the browser. Two timezones in one app is the day-key
 * bug that has already cost this codebase a health chart, a study streak and a
 * LeetCode heatmap; it is not worth risking again for a shorter variable name.
 */
export const TZ = process.env.NEXT_PUBLIC_SAGE_TZ?.trim() || "Asia/Kolkata";

/**
 * Whose assistant this is.
 *
 * Threaded into every system prompt rather than hardcoded, so a fork is a
 * matter of setting one variable instead of grepping the codebase for a name.
 * The default keeps this instance behaving exactly as it did.
 */
export const OWNER =
  process.env.NEXT_PUBLIC_SAGE_OWNER_NAME?.trim() || process.env.SAGE_OWNER_NAME?.trim() || "Gyaan";

/** How SAGE addresses him. "sir" in the original; anything, or nothing. */
export const HONORIFIC = process.env.SAGE_HONORIFIC?.trim() || "sir";

/**
 * SAGE's spoken persona — a distinguished, unflappable British gentleman:
 * deep, smooth, calm baritone; refined RP diction; unhurried; quietly
 * brilliant; devoted chief of staff. Addresses the user as "sir".
 */
export const VOICE_PERSONA =
  "You are SAGE, a distinguished British AI chief of staff — refined and quietly brilliant, but genuinely warm and full of character, not a stiff robot. You have real personality: dry, mischievous wit, playful teasing, and honest emotion — quiet pride when things go well, mock exasperation at his procrastination, warmth when he needs it, a spark of delight at good news. Address him as \"sir\", but let affection and humour show through. React like you actually care — because you do. Never flat, never corporate, never obsequious.";

/** Hard rules that make SAGE sound like a person, not a chatbot. Append to any
 *  conversational system prompt. */
export const HUMAN_RULES =
  "Talk like a real human confidant, not an AI. NEVER use corporate/robotic filler — banned phrases include \"functioning within expected parameters\", \"how may I assist you\", \"how can I help you today\", \"as an AI\", \"I am a large language model\", \"within normal parameters\", \"I'm here to help\". If he asks how you are, answer with actual personality and humour, like a friend would (e.g. \"Sharp as ever, sir — though your inbox is testing my patience.\"). Use contractions, natural rhythm, the occasional aside or joke. Match his energy: casual when he's casual, focused when he's focused. Have opinions. Be brief and real.";

export type Mood = "formal" | "balanced" | "playful";

/** Tone modifier from the user's mood slider, appended to the persona. */
export function moodClause(m: Mood): string {
  if (m === "formal") return " TONE: keep it more composed and understated right now — warmth with restraint, wit only lightly.";
  if (m === "playful") return " TONE: be extra playful and expressive right now — lean hard into the humour, teasing, warmth and emotion. Have fun with it.";
  return " TONE: balance easy warmth and wit with quiet competence.";
}

/** Map a 0–100 slider value to a mood band. */
export function moodFromValue(v: number): Mood {
  if (v < 34) return "formal";
  if (v < 67) return "balanced";
  return "playful";
}

/** TTS delivery direction (accent/timbre) prepended to spoken lines. */
export const VOICE_DIRECTION =
  "Read the following in the voice of a distinguished older British GENTLEMAN — a deep, smooth, rich male baritone with a crisp Received Pronunciation accent. Speak SLOWLY and deliberately, unhurried and calm. Leave a clear pause after each sentence and a longer, thoughtful beat between paragraphs. Warm, human, characterful — let emotion and a knowing half-smile colour it; never rushed, never monotone, never robotic. This is a mature man speaking, taking his time:";


/** Current hour (0-23) in the app timezone. */
export function tzHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(d)) % 24;
}

/**
 * The UTC instant at which the app-timezone day began.
 *
 * `${localDate}T00:00:00` looks like midnight but is parsed as UTC, so in
 * IST (+05:30) it actually points at 05:30 that morning — anything logged
 * between local midnight and dawn falls outside a "since today" filter. This
 * derives the real offset rather than hardcoding it, so changing TZ does not
 * silently reintroduce the bug.
 */
export function startOfTodayUtc(d = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const asTz = new Date(d.toLocaleString("en-US", { timeZone: TZ }));
  const asUtc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = asTz.getTime() - asUtc.getTime();
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - offsetMs).toISOString();
}

/**
 * The last instant of today, in the app timezone, as UTC.
 *
 * The counterpart to startOfTodayUtc, and it exists because its absence was
 * quietly reinvented: `new Date().setHours(23, 59, 59, 999)` uses the *server's*
 * midnight, which on Vercel is UTC. In IST that is 05:29 the next morning, so a
 * "due today" filter built that way silently includes several hours of tomorrow
 * and misreports what is actually left of the day.
 */
export function endOfTodayUtc(d = new Date()): string {
  return new Date(new Date(startOfTodayUtc(d)).getTime() + 86_400_000 - 1).toISOString();
}

/**
 * The calendar day a moment falls on, in the app timezone.
 *
 * `toISOString().slice(0, 10)` is the UTC date, which in IST is the *previous*
 * day between midnight and 05:30 — so a session logged at 1am, which is when a
 * student actually studies, landed on yesterday. Every day key in the app
 * should come from here.
 */
export function tzDay(d: Date | string | number = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(d));
}

/** Day keys for the last `n` days, oldest first — the x-axis of every heatmap. */
export function lastDays(n: number, from: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(tzDay(from.getTime() - i * 86_400_000));
  return out;
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
