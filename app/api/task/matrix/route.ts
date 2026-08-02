import { NextResponse } from "next/server";
import { buildMatrix, moveToQuadrant, QUADRANTS, type Quadrant } from "@/core/tasks/eisenhower";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, data: await buildMatrix() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { taskId?: string; quadrant?: string } | null;
  if (!body?.taskId || !QUADRANTS.includes(body.quadrant as Quadrant)) {
    return NextResponse.json({ ok: false, error: "taskId and quadrant required" }, { status: 400 });
  }
  const ok = await moveToQuadrant(body.taskId, body.quadrant as Quadrant);
  if (!ok) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, data: await buildMatrix() });
}
