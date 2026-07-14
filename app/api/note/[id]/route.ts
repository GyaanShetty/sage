import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (typeof body.title === "string") update.title = body.title.slice(0, 120);
  if (body.content && typeof body.content === "object") update.content = body.content;

  const { error } = await db
    .from("Note")
    .update(update)
    .eq("id", id)
    .eq("userId", DEFAULT_USER_ID);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await db.from("Note").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
