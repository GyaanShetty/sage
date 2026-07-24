import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { embedText, toVectorLiteral } from "@/infrastructure/embeddings";

const TYPES = ["fact", "preference", "goal", "routine", "skill", "relationship", "episode"];

/** Manually add a memory. Embedded so recall + the Mind Graph pick it up. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { content?: string; type?: string; importance?: number }
    | null;
  const content = body?.content?.trim();
  if (!content) return NextResponse.json({ ok: false, error: "content required" }, { status: 400 });

  await ensureDefaultUser();
  const type = TYPES.includes(String(body?.type)) ? body!.type : "fact";
  const importance =
    typeof body?.importance === "number" ? Math.max(0, Math.min(1, body.importance)) : 0.7;

  const embedding = await embedText(content).catch(() => null);
  const id = crypto.randomUUID();
  const { error } = await db.from("Memory").insert({
    id,
    userId: DEFAULT_USER_ID,
    type,
    content: content.slice(0, 600),
    confidence: 1, // user-stated → certain
    importance,
    sourceType: "user",
    ...(embedding ? { embedding: toVectorLiteral(embedding) } : {}),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: { id } });
}
