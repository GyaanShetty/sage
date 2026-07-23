import { NextResponse } from "next/server";
import { getTickTickTasks, completeTickTask } from "@/infrastructure/integrations/ticktick";

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
