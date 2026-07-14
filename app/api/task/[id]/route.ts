import { NextResponse } from "next/server";
import { z } from "zod";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

const patchSchema = z.object({
  status: z.enum(["todo", "doing", "done", "cancelled"]).optional(),
  title: z.string().min(1).max(200).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid update" }, { status: 400 });
  }
  const { error } = await db
    .from("Task")
    .update(parsed.data)
    .eq("id", id)
    .eq("userId", DEFAULT_USER_ID);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await db.from("Task").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
