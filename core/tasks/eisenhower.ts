import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { getTaskMeta, type TaskMeta } from "./meta";

/**
 * The Eisenhower matrix, derived rather than declared.
 *
 * The usual implementation asks you to drag each task into a quadrant, which
 * means maintaining a second opinion about every task by hand — and that
 * opinion goes stale the moment a deadline moves. Here importance comes from
 * priority (which you already set) and urgency from the due date (which you
 * already set), so the grid is a *view* of the task list rather than a parallel
 * copy of it. Move a deadline and the task moves quadrant on its own.
 *
 * An explicit override is still allowed, because "important" is sometimes a
 * judgement no field captures — but it is the exception, not the price of entry.
 */

export const QUADRANTS = ["do", "schedule", "delegate", "drop"] as const;
export type Quadrant = (typeof QUADRANTS)[number];

export const QUADRANT_META: Record<Quadrant, { label: string; hint: string; urgent: boolean; important: boolean }> = {
  do:       { label: "Do now",   hint: "urgent · important",       urgent: true,  important: true },
  schedule: { label: "Schedule", hint: "important, not urgent",    urgent: false, important: true },
  delegate: { label: "Delegate", hint: "urgent, not important",    urgent: true,  important: false },
  drop:     { label: "Drop",     hint: "neither — cut it",         urgent: false, important: false },
};

export interface MatrixTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  dueAt: string | null;
  quadrant: Quadrant;
  /** True when the quadrant came from a manual override rather than the fields. */
  pinned: boolean;
  urgent: boolean;
  important: boolean;
  hoursToDue: number | null;
  estimateMin?: number;
  tags?: string[];
}

/** Inside this many hours counts as urgent. Two days is the point at which a
 *  deadline starts dictating today's order rather than next week's. */
const URGENT_HOURS = 48;
/** Priority 0 (urgent) and 1 (high) are the important half of the scale. */
const IMPORTANT_MAX_PRIORITY = 1;

export function classify(
  task: { priority: number; dueAt: string | null },
  meta?: TaskMeta,
): { quadrant: Quadrant; urgent: boolean; important: boolean; hoursToDue: number | null; pinned: boolean } {
  const hoursToDue = task.dueAt
    ? (new Date(task.dueAt).getTime() - Date.now()) / 3_600_000
    : null;

  // Overdue is the most urgent thing there is, and a negative number would
  // otherwise fall outside the window and read as "not urgent".
  const urgent = hoursToDue !== null && hoursToDue <= URGENT_HOURS;
  const important = task.priority <= IMPORTANT_MAX_PRIORITY;

  const override = meta?.quadrant;
  if (override && QUADRANTS.includes(override)) {
    return { quadrant: override, urgent, important, hoursToDue, pinned: true };
  }

  const quadrant: Quadrant =
    urgent && important ? "do"
    : important ? "schedule"
    : urgent ? "delegate"
    : "drop";

  return { quadrant, urgent, important, hoursToDue, pinned: false };
}

export async function buildMatrix(): Promise<Record<Quadrant, MatrixTask[]>> {
  const { data } = await db
    .from("Task")
    .select("id, title, status, priority, dueAt")
    .eq("userId", DEFAULT_USER_ID)
    .neq("status", "done")
    .neq("status", "cancelled")
    .order("dueAt", { ascending: true, nullsFirst: false })
    .limit(200);

  const rows = (data ?? []) as { id: string; title: string; status: string; priority: number; dueAt: string | null }[];
  const meta = await getTaskMeta(rows.map((r) => r.id));

  const grid = Object.fromEntries(QUADRANTS.map((q) => [q, [] as MatrixTask[]])) as Record<Quadrant, MatrixTask[]>;

  for (const t of rows) {
    const m = meta[t.id];
    const c = classify(t, m);
    grid[c.quadrant].push({
      id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt,
      quadrant: c.quadrant, pinned: c.pinned, urgent: c.urgent, important: c.important,
      hoursToDue: c.hoursToDue,
      estimateMin: m?.estimateMin,
      tags: m?.tags,
    });
  }

  // Soonest deadline first inside each quadrant; undated tasks last, since a
  // dated one is always the more actionable of the two.
  for (const q of QUADRANTS) {
    grid[q].sort((a, b) => {
      if (a.hoursToDue === null && b.hoursToDue === null) return a.priority - b.priority;
      if (a.hoursToDue === null) return 1;
      if (b.hoursToDue === null) return -1;
      return a.hoursToDue - b.hoursToDue;
    });
  }
  return grid;
}

/**
 * Move a task into a quadrant by hand.
 *
 * Rather than storing the quadrant as an opaque override, this writes back the
 * fields that *imply* it — priority for importance, a due date for urgency — so
 * the task's own record stays honest and TickTick, the notification engine and
 * the report all see the change too. The override is recorded as well, so a
 * deliberate placement is not undone by the next deadline shift.
 */
export async function moveToQuadrant(taskId: string, quadrant: Quadrant): Promise<boolean> {
  const target = QUADRANT_META[quadrant];
  const { data: task } = await db
    .from("Task")
    .select("priority, dueAt")
    .eq("id", taskId)
    .eq("userId", DEFAULT_USER_ID)
    .maybeSingle();
  if (!task) return false;

  const patch: Record<string, unknown> = {};
  const currentlyImportant = (task.priority as number) <= IMPORTANT_MAX_PRIORITY;
  if (target.important !== currentlyImportant) {
    patch.priority = target.important ? 1 : 2;
  }

  const hours = task.dueAt ? (new Date(task.dueAt as string).getTime() - Date.now()) / 3_600_000 : null;
  const currentlyUrgent = hours !== null && hours <= URGENT_HOURS;
  if (target.urgent && !currentlyUrgent) {
    // Tomorrow evening: inside the urgent window without pretending it is due
    // in the next ten minutes.
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(18, 0, 0, 0);
    patch.dueAt = due.toISOString();
  } else if (!target.urgent && currentlyUrgent) {
    // Push beyond the window rather than clearing the date — deleting a
    // deadline the user set is not ours to do.
    const due = new Date(Date.now() + 7 * 86_400_000);
    due.setHours(18, 0, 0, 0);
    patch.dueAt = due.toISOString();
  }

  if (Object.keys(patch).length > 0) {
    await db.from("Task").update(patch).eq("id", taskId).eq("userId", DEFAULT_USER_ID);
  }

  const { setTaskMeta } = await import("./meta");
  await setTaskMeta(taskId, { quadrant });
  return true;
}
