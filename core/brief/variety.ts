import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Stop the briefings reading the same every morning.
 *
 * Two things were causing it, and both needed fixing:
 *
 * 1. The generators were fed slow-moving inputs — open tasks, calendar,
 *    unread mail. If the calendar is not connected and the task list is
 *    stable, the model receives near-identical input two days running and
 *    quite reasonably produces near-identical output. Widening the inputs
 *    with things that genuinely change daily (headlines, market moves,
 *    training, the day of the week) is the substantive half of the fix.
 *
 * 2. Nothing ever told the model what it had already said. A model with no
 *    memory of yesterday will reach for the same opening and the same angle
 *    every time, because it is the most probable one. Showing it the last
 *    few briefs and asking for a different angle is the other half.
 */

/** The last few briefs of a given kind, newest first. */
export async function recentBriefs(type: string, limit = 4): Promise<string[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", type)
    .order("createdAt", { ascending: false })
    .limit(limit);

  return (data ?? [])
    .map((r) => {
      const p = r.payload as { text?: string; data?: { summary?: string; spoken?: string } } | null;
      return p?.text ?? p?.data?.spoken ?? p?.data?.summary ?? "";
    })
    .filter((s) => s.trim().length > 0);
}

/**
 * Prompt text that makes repetition explicit rather than hoping for novelty.
 *
 * Naming the previous openings matters more than a general "be varied": the
 * failure is almost always the first six words, and a model shown its own
 * opener will avoid it far more reliably than one told to be creative.
 */
export function noRepeatClause(previous: string[], opts: { fixedOpening?: boolean } = {}): string {
  if (previous.length === 0) return "";

  // The spoken debrief is *required* to start with "Good morning, sir." — so
  // comparing raw openers there would tell it to break its own format. Strip
  // the greeting first and judge the sentence that follows it, which is the
  // one that was actually repeating.
  const body = (p: string) =>
    opts.fixedOpening ? p.replace(/^\s*(good\s+(morning|afternoon|evening))[,\s]*sir[.,!]?\s*/i, "") : p;

  const openers = previous
    .map((p) => body(p).trim().split(/\s+/).slice(0, 6).join(" "))
    .filter(Boolean);

  return [
    "\n\nYou have briefed him before. These are your most recent briefs, newest first:",
    ...previous.map((p, i) => `${i + 1}. ${p.slice(0, 400)}`),
    "",
    "Do not repeat them. Specifically:",
    `- Do not open with any of these phrasings: ${openers.map((o) => `"${o}…"`).join("; ")}`,
    "- Lead with something you have NOT led with in those briefs. If the same fact is still the most important, say what has CHANGED about it since, or say plainly that it is unchanged and move to the next thing.",
    "- If genuinely little has changed, be honest and brief about it rather than restating yesterday in new words. A short honest brief beats a padded identical one.",
  ].join("\n");
}

/** A day's character — cheap variety the model can actually use. */
export function dayContext(tz: string): string {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long" }).format(now);
  const dow = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(now);
  const weekend = dow === "Sat" || dow === "Sun";
  return `Today is ${weekday} ${date}${weekend ? " (weekend — pace the day accordingly)" : ""}.`;
}
