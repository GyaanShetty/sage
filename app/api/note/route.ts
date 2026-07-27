import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";

/** Create a note. Pass { journal: true } to get-or-create today's journal entry. */
export async function POST(req: Request) {
  await ensureDefaultUser();
  const body = await req.json().catch(() => ({}));

  if (body.journal) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: existing } = await db
      .from("Note")
      .select("id, title, content, kind")
      .eq("userId", DEFAULT_USER_ID)
      .eq("kind", "journal")
      .eq("journalDate", today.toISOString())
      .maybeSingle();
    if (existing) return NextResponse.json({ ok: true, data: existing });

    const note = {
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      kind: "journal",
      title: today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      content: { type: "doc", content: [] },
      journalDate: today.toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const { error } = await db.from("Note").insert(note);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, data: note });
  }

  const paragraphs =
    typeof body.content === "string" && body.content.trim()
      ? body.content.split(/\n{2,}|\n/).filter(Boolean).map((p: string) => ({ type: "paragraph", content: [{ type: "text", text: p }] }))
      : [];
  const note = {
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    kind: "doc",
    title: typeof body.title === "string" && body.title ? body.title.slice(0, 120) : "Untitled",
    content: { type: "doc", content: paragraphs },
    updatedAt: new Date().toISOString(),
  };
  const { error } = await db.from("Note").insert(note);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: note });
}
