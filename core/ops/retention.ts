import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Keeping the Event table from eating the database.
 *
 * Nearly everything in SAGE is stored as a row in one generic Event table, and
 * nothing ever deleted any of it. Supabase's free tier stops at 500MB, and the
 * rows that grow fastest are the least valuable ones: dedupe markers, cache
 * entries, "have we pushed this today" flags. A location webhook firing every
 * few minutes writes more rows in a month than a year of actual portfolio
 * history.
 *
 * So retention is explicit and per-type, and the default is to keep. A type
 * not listed here is never touched — losing real data to a tidy-up would be
 * far worse than paying for storage, so anything unclassified errs that way.
 */

/** Days to keep, by event type. Absent from this list = kept forever. */
const RETENTION_DAYS: Record<string, number> = {
  // Bookkeeping. Regenerable, or meaningless once the day has passed.
  "notify.sent": 14,          // "already pushed today" markers
  "debrief.played": 14,       // "already spoke today" claim
  "anticipate.warned": 14,
  // Was 7. Still the highest-volume type, but no longer the lowest value:
  // whereIs() reads these, and the ambient and brief layers reason about
  // where he has been. Thirty days is enough for "you are usually at the gym
  // by now" without keeping a year of movement history around.
  "location.update": 30,
  "search": 30,

  // Generated content: cheap to regenerate, and stale within weeks.
  "debrief.generated": 30,
  "brief.generated": 60,      // /api/brief/history reads the last 14
  "morning.synthesis": 60,
  "market.analysis": 30,
  "flashcards.daily": 60,
  "career.autoscan": 60,
  "lab.generated": 90,
  "agent.completed": 90,
  "automation.completed": 90,
  "reminder.fired": 90,

  // Diagnostics. Useful while a problem is live, noise a season later.
  "ops.triage": 90,
  "health.dayClosed": 365,
};

/**
 * Types that are the user's own data and must survive indefinitely.
 * Listed for the reader rather than the code: the code keeps anything absent
 * from RETENTION_DAYS, but writing them down makes the intent auditable and
 * stops a future edit from casually adding one of these to the prune list.
 */
export const NEVER_PRUNE = [
  "portfolio.holding", "portfolio.trade", "portfolio.snapshot", "portfolio.alert", "portfolio.income",
  "health.workout", "health.report", "health.goals",
  "career.application", "finance.expense", "link.edge", "task.meta",
  "skill.node", "skill.progress", "research.brief", "review.card",
  "life.report", "weekly.review", "daily.digest", "memory.consolidated",
  "push.subscription", "phone.action", "ops.error", "file.uploaded",
] as const;

export interface PruneResult {
  type: string;
  deleted: number;
  keptDays: number;
}

/**
 * Delete what has aged out.
 *
 * Deletes are done per type with an explicit cutoff — never a bare delete
 * with a wide filter, because a mistake there is unrecoverable and this runs
 * unattended at 3am.
 */
/** Trash older than its window goes with the nightly sweep. */
async function purgeAgedTrash(): Promise<number> {
  const { purgeTrash, TRASH_DAYS } = await import("./trash");
  return purgeTrash(TRASH_DAYS).catch(() => 0);
}

export async function pruneEvents(dryRun = false): Promise<{ results: PruneResult[]; total: number }> {
  const results: PruneResult[] = [];

  for (const [type, days] of Object.entries(RETENTION_DAYS)) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

    if (dryRun) {
      const { count } = await db
        .from("Event")
        .select("id", { count: "exact", head: true })
        .eq("userId", DEFAULT_USER_ID)
        .eq("type", type)
        .lt("createdAt", cutoff);
      results.push({ type, deleted: count ?? 0, keptDays: days });
      continue;
    }

    const { data, error } = await db
      .from("Event")
      .delete()
      .eq("userId", DEFAULT_USER_ID)
      .eq("type", type)
      .lt("createdAt", cutoff)
      .select("id");

    // One type failing must not abort the sweep — the others still need doing.
    if (error) continue;
    results.push({ type, deleted: data?.length ?? 0, keptDays: days });
  }

  const kept = results.filter((r) => r.deleted > 0);
  // Trash has its own window (30 days) rather than a per-type retention rule,
  // because what matters is how long ago it was deleted, not what it was.
  const trashed = dryRun ? 0 : await purgeAgedTrash();
  if (trashed > 0) kept.push({ type: "ops.trash", deleted: trashed, keptDays: 30 });

  return { results: kept, total: kept.reduce((a, r) => a + r.deleted, 0) };
}

/**
 * Where the rows actually are.
 *
 * Counting per type is the only way to know whether the database is filling
 * with portfolio history worth keeping or with dedupe markers worth deleting,
 * and the answer decides what to do about it.
 */
export async function storageBreakdown(): Promise<{ type: string; rows: number; retention: string }[]> {
  const types = [...new Set([...Object.keys(RETENTION_DAYS), ...NEVER_PRUNE])];

  const counts = await Promise.all(
    types.map(async (type) => {
      const { count } = await db
        .from("Event")
        .select("id", { count: "exact", head: true })
        .eq("userId", DEFAULT_USER_ID)
        .eq("type", type);
      return {
        type,
        rows: count ?? 0,
        retention: RETENTION_DAYS[type] ? `${RETENTION_DAYS[type]}d` : "kept",
      };
    }),
  );

  return counts.filter((c) => c.rows > 0).sort((a, b) => b.rows - a.rows);
}
