import { NextResponse } from "next/server";
import { getTickTickTasks, completeTickTask, updateTickTaskPriority } from "@/infrastructure/integrations/ticktick";

export const revalidate = 60;

export async function GET() {
  const data = await getTickTickTasks();
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  const { projectId, taskId } = (await req.json()) as { projectId?: string; taskId?: string };
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
