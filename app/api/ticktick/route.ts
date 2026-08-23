import { NextResponse } from "next/server";
import { getTickTickTasks, completeTickTask, updateTickTaskPriority, createTickTask, deleteTickTask } from "@/infrastructure/integrations/ticktick";

/**
 * Never cached.
 *
 * This was `revalidate = 60`, which is the whole reason adding a task looked
 * like it had not synced: the client adds, refetches immediately, and Next
 * serves the list it cached up to a minute ago — the one without the new task.
 * The task then appeared out of nowhere on the next poll two minutes later.
 *
 * A cache in front of a list the user is actively editing buys a round trip
 * and costs the thing they just did.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getTickTickTasks();
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string; taskId?: string;
    title?: string; dueAt?: string; priority?: number;
  };

  // Creating a task: the band was read-and-complete only, so there was nowhere
  // in SAGE to actually put something INTO TickTick.
  if (body.title) {
    const id = await createTickTask({
      title: body.title,
      dueAt: body.dueAt ?? null,
      priority: typeof body.priority === "number" ? body.priority : 2,
    });
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "TickTick isn't connected — Settings → Connect TickTick." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, data: { id } });
  }

  const { projectId, taskId } = body;
  if (!projectId || !taskId) return NextResponse.json({ ok: false, error: "projectId and taskId required" }, { status: 400 });
  const ok = await completeTickTask(projectId, taskId);
  // Report the outcome rather than a bare shrug: the band puts the row back
  // when this is false, and it cannot do that if a failure looks like success.
  if (!ok) return NextResponse.json({ ok: false, error: "TickTick refused that — it may already be gone." }, { status: 502 });
  return NextResponse.json({ ok: true });
}

/** Remove a task entirely, rather than completing it. */
export async function DELETE(req: Request) {
  const { projectId, taskId } = (await req.json().catch(() => ({}))) as { projectId?: string; taskId?: string };
  if (!projectId || !taskId) return NextResponse.json({ ok: false, error: "projectId and taskId required" }, { status: 400 });
  const ok = await deleteTickTask(projectId, taskId);
  if (!ok) return NextResponse.json({ ok: false, error: "TickTick wouldn't delete that." }, { status: 502 });
  return NextResponse.json({ ok: true });
}

/** Re-classify a task by changing its priority (move it between quadrants). */
export async function PATCH(req: Request) {
  const { projectId, taskId, priority } = (await req.json()) as { projectId?: string; taskId?: string; priority?: number };
  if (!projectId || !taskId || typeof priority !== "number")
    return NextResponse.json({ ok: false, error: "projectId, taskId, priority required" }, { status: 400 });
  const ok = await updateTickTaskPriority(projectId, taskId, priority);
  return NextResponse.json({ ok: !!ok });
}
