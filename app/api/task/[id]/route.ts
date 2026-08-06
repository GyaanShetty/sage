import { NextResponse } from "next/server";
import { trashRow } from "@/core/ops/trash";
import { z } from "zod";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { getTaskMeta, setTaskMeta, toggleTaskTimer } from "@/core/tasks/meta";
import { linksFor } from "@/core/links/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The whole task: row, meta and links in one round trip. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: task } = await db
    .from("Task")
    .select("id, title, status, priority, dueAt, source, createdAt")
    .eq("id", id)
    .eq("userId", DEFAULT_USER_ID)
    .maybeSingle();
  if (!task) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const [meta, links] = await Promise.all([getTaskMeta([id]), linksFor("task", id)]);
  return NextResponse.json({ ok: true, data: { task, meta: meta[id] ?? null, links } });
}

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  status: z.enum(["todo", "doing", "done", "cancelled"]).optional(),
  priority: z.number().int().min(0).max(3).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  estimateMin: z.number().int().min(0).max(10_000).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  notes: z.string().max(4000).optional(),
  /** Start/stop the clock. */
  timer: z.literal("toggle").optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid" }, { status: 400 });
  const p = parsed.data;

  // Columns and meta are separate stores; only touch the one that changed.
  const row: Record<string, unknown> = {};
  if (p.title !== undefined) row.title = p.title;
  if (p.status !== undefined) row.status = p.status;
  if (p.priority !== undefined) row.priority = p.priority;
  if (p.dueAt !== undefined) row.dueAt = p.dueAt;
  if (Object.keys(row).length > 0) {
    const { error } = await db.from("Task").update(row).eq("id", id).eq("userId", DEFAULT_USER_ID);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (p.timer === "toggle") {
    return NextResponse.json({ ok: true, data: { meta: await toggleTaskTimer(id) } });
  }

  const metaPatch: Record<string, unknown> = {};
  if (p.estimateMin !== undefined) metaPatch.estimateMin = p.estimateMin;
  if (p.tags !== undefined) metaPatch.tags = p.tags;
  if (p.notes !== undefined) metaPatch.notes = p.notes;
  const meta = Object.keys(metaPatch).length > 0 ? await setTaskMeta(id, metaPatch) : null;

  return NextResponse.json({ ok: true, data: { meta } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Copied to the trash first, so a mis-tap on a phone is recoverable for
  // thirty days rather than final.
  try {
    await trashRow("Task", id);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
