import { NextResponse } from "next/server";
import { z } from "zod";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  dueAt: z.string().datetime().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  /** Set false to keep a task local — used when the source is TickTick itself. */
  mirror: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid task" }, { status: 400 });
  }
  await ensureDefaultUser();
  const task = {
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    title: parsed.data.title,
    priority: parsed.data.priority ?? 2,
    ...(parsed.data.dueAt ? { dueAt: parsed.data.dueAt } : {}),
  };
  const { error } = await db.from("Task").insert(task);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Mirror into TickTick, exactly as the voice/agent path already did. Only
  // AI-created tasks were being mirrored, so anything added from the UI — the
  // morning block's "add as task", a research action, the workspace — stayed
  // in SAGE and the two lists drifted apart. Deliberately after the insert and
  // never awaited into the failure path: a task missing from TickTick is a
  // mild annoyance, losing it because TickTick was slow is not.
  let mirrored = false;
  if (parsed.data.mirror !== false) {
    const { createTickTask } = await import("@/infrastructure/integrations/ticktick");
    const created = await createTickTask({
      title: task.title,
      dueAt: parsed.data.dueAt ?? null,
      priority: task.priority,
    }).catch(() => null);

    /*
     * Record the link here, not later.
     *
     * The copy was being posted and the returned id thrown away, so the
     * two tasks were strangers from the moment they were created and
     * nothing could ever match them again. The sync can adopt an orphan
     * pair by title, but only once it next runs and only while the
     * titles are still identical — recording it now is free and exact.
     */
    if (created) {
      mirrored = true;
      const { linkTask } = await import("@/core/tasks/sync");
      await linkTask(task.id, created, {
        title: task.title,
        done: false,
        dueAt: parsed.data.dueAt ?? null,
        priority: task.priority,
      }).catch(() => { /* the task exists; the link can be adopted later */ });
    }
  }

  return NextResponse.json({ ok: true, data: { ...task, mirroredToTickTick: mirrored } });
}
