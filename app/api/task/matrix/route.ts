import { NextResponse } from "next/server";
import { buildMatrix, moveToQuadrant, createInQuadrant, QUADRANTS, type Quadrant } from "@/core/tasks/eisenhower";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, data: await buildMatrix() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { taskId?: string; title?: string; quadrant?: string } | null;
  if (!QUADRANTS.includes(body?.quadrant as Quadrant)) {
    return NextResponse.json({ ok: false, error: "quadrant required" }, { status: 400 });
  }

  // A title instead of an id means "write this down, here" — the grid can be
  // added to, not only rearranged.
  if (!body?.taskId) {
    const title = body?.title?.trim();
    if (!title) return NextResponse.json({ ok: false, error: "taskId or title required" }, { status: 400 });
    try {
      await createInQuadrant(title, body!.quadrant as Quadrant);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, data: await buildMatrix() });
  }

  const ok = await moveToQuadrant(body.taskId, body.quadrant as Quadrant);
  if (!ok) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, data: await buildMatrix() });
}
