import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { embedText, toVectorLiteral } from "@/infrastructure/embeddings";

const TYPES = ["fact", "preference", "goal", "routine", "skill", "relationship", "episode"];

/** Edit a memory: content (re-embedded), type, or importance (pin = 1). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as
    | { content?: string; type?: string; importance?: number }
    | null;
  if (!body) return NextResponse.json({ ok: false, error: "no body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.content === "string" && body.content.trim()) {
    patch.content = body.content.trim().slice(0, 600);
    const embedding = await embedText(patch.content as string).catch(() => null);
    if (embedding) patch.embedding = toVectorLiteral(embedding);
  }
  if (body.type && TYPES.includes(body.type)) patch.type = body.type;
  if (typeof body.importance === "number") patch.importance = Math.max(0, Math.min(1, body.importance));
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });

  const { error } = await db.from("Memory").update(patch).eq("id", id).eq("userId", DEFAULT_USER_ID);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await db.from("Memory").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
