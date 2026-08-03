import { NextResponse } from "next/server";
import { getTickTickTasks, completeTickTask, updateTickTaskPriority, createTickTask } from "@/infrastructure/integrations/ticktick";

export const revalidate = 60;

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
  return NextResponse.json({ ok: !!ok });
}

/** Re-classify a task by changing its priority (move it between quadrants). */
export async function PATCH(req: Request) {
  const { projectId, taskId, priority } = (await req.json()) as { projectId?: string; taskId?: string; priority?: number };
  if (!projectId || !taskId || typeof priority !== "number")
    return NextResponse.json({ ok: false, error: "projectId, taskId, priority required" }, { status: 400 });
  const ok = await updateTickTaskPriority(projectId, taskId, priority);
  return NextResponse.json({ ok: !!ok });
}
