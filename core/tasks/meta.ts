import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * The parts of a task the Task table has no column for.
 *
 * Task is title, status, priority, dueAt and nothing else. Everything a real
 * task needs — how long it will take, what it is about, where the relevant
 * page or file is — had nowhere to live. Adding columns means a migration
 * applied by hand in the Supabase console, which is a bad thing to require
 * before a feature works, so this rides in the generic Event store beside the
 * task, exactly as career, portfolio and health data already do.
 *
 * One row per task, replaced on write. Reads are bulk by design: a task list
 * must not turn into one query per row.
 */

const TYPE = "task.meta";

export interface TaskMeta {
  taskId: string;
  /** Expected effort in minutes. */
  estimateMin?: number;
  /** Free tags — "deep work", "admin", "goldman". */
  tags?: string[];
  /** Longer body: context, acceptance criteria, whatever the title cannot hold. */
  notes?: string;
  /** When work actually started, so elapsed time is measurable rather than guessed. */
  startedAt?: string;
  /** Minutes actually spent, accumulated across sittings. */
  spentMin?: number;
  updatedAt: string;
}

export async function getTaskMeta(taskIds: string[]): Promise<Record<string, TaskMeta>> {
  if (taskIds.length === 0) return {};
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .limit(1000);

  const want = new Set(taskIds);
  const out: Record<string, TaskMeta> = {};
  for (const row of data ?? []) {
    const m = row.payload as TaskMeta;
    // Newest wins: rows are appended, and an older one must not overwrite a
    // newer one just because it came back later in the page.
    if (m?.taskId && want.has(m.taskId)) {
      const prev = out[m.taskId];
      if (!prev || m.updatedAt > prev.updatedAt) out[m.taskId] = m;
    }
  }
  return out;
}

/** Merge a patch into a task's meta. Absent fields are left alone; explicit
 *  nulls clear. */
export async function setTaskMeta(
  taskId: string,
  patch: Partial<Omit<TaskMeta, "taskId" | "updatedAt">>,
): Promise<TaskMeta> {
  const current = (await getTaskMeta([taskId]))[taskId];
  const merged: TaskMeta = {
    ...(current ?? { taskId, updatedAt: new Date().toISOString() }),
    ...patch,
    taskId,
    updatedAt: new Date().toISOString(),
  };

  const { data: existing } = await db
    .from("Event")
    .select("id")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .contains("payload", { taskId })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await db.from("Event").update({ payload: merged }).eq("id", existing.id);
  } else {
    await db.from("Event").insert({
      id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE, payload: merged,
    });
  }
  return merged;
}

/** Start or stop the clock on a task, returning the updated meta. Stopping
 *  accumulates rather than replaces, so a task worked across three sittings
 *  reports the total. */
export async function toggleTaskTimer(taskId: string): Promise<TaskMeta> {
  const current = (await getTaskMeta([taskId]))[taskId];
  if (current?.startedAt) {
    const elapsed = Math.max(0, Math.round((Date.now() - new Date(current.startedAt).getTime()) / 60_000));
    return setTaskMeta(taskId, { startedAt: undefined, spentMin: (current.spentMin ?? 0) + elapsed });
  }
  return setTaskMeta(taskId, { startedAt: new Date().toISOString() });
}
