import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await db.from("Source").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
