/**
 * The Eisenhower rule, and only the rule.
 *
 * There are two matrices in SAGE and they read different task lists: the
 * dashboard band renders live TickTick tasks, and the workspace matrix builds
 * from the local Task table. Both need the same *classification*; neither may
 * take the other's data.
 *
 * That distinction matters more than it looks, because **the two priority
 * scales are inverted**. TickTick counts up — 5 is high, 0 is none. The local
 * Task table counts down — 0 is urgent, 3 is low. Passing one straight into
 * the other's classifier files every important task under "Eliminate" and
 * every trivial one under "Do first", which would present as a UI glitch and
 * be genuinely nasty to trace.
 *
 * So this module takes booleans that have already been normalised by the
 * caller who knows its own scale, and does nothing but the two-axis split.
 */

export type Quadrant = "do" | "schedule" | "delegate" | "drop";

/** Inside this window a deadline dictates today's order rather than next
 *  week's. Shared so the band and the engine cannot drift apart on it. */
export const URGENT_HOURS = 48;

/**
 * Hours until a deadline, or null when there is none.
 *
 * Overdue returns a negative number deliberately: it is the most urgent thing
 * there is, and clamping it to zero would make "three days late" and "due now"
 * indistinguishable.
 */
export function hoursUntil(due: string | null | undefined, now = Date.now()): number | null {
  if (!due) return null;
  const t = new Date(due).getTime();
  return Number.isFinite(t) ? (t - now) / 3_600_000 : null;
}

/** Urgent means due inside the window, or already past it. */
export function isUrgent(hoursToDue: number | null): boolean {
  return hoursToDue !== null && hoursToDue <= URGENT_HOURS;
}

export function classifyQuadrant({ urgent, important }: { urgent: boolean; important: boolean }): Quadrant {
  if (urgent && important) return "do";
  if (important) return "schedule";
  if (urgent) return "delegate";
  return "drop";
}
