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
  let tickId: string | null = null;
  if (parsed.data.mirror !== false) {
    const { createTickTask } = await import("@/infrastructure/integrations/ticktick");
    tickId = await createTickTask({
      title: task.title,
      dueAt: parsed.data.dueAt ?? null,
      priority: task.priority,
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true, data: { ...task, mirroredToTickTick: !!tickId } });
}
