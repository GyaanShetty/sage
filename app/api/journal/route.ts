import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";

interface TiptapDoc {
  type: "doc";
  content: { type: string; content?: { type: string; text?: string }[] }[];
}

/** Append a timestamped entry paragraph to today's journal note. */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ ok: false, error: "Empty" }, { status: 400 });
  await ensureDefaultUser();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: existing } = await db
    .from("Note")
    .select("id, content")
    .eq("userId", DEFAULT_USER_ID)
    .eq("kind", "journal")
    .eq("journalDate", today.toISOString())
    .maybeSingle();

  const now = new Date();
  const stamp = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const paragraph = {
    type: "paragraph",
    content: [{ type: "text", text: `${stamp} — ${text.trim()}` }],
  };

  if (existing) {
    const doc = (existing.content ?? { type: "doc", content: [] }) as TiptapDoc;
    doc.content = [paragraph, ...(doc.content ?? [])];
    await db.from("Note").update({ content: doc, updatedAt: now.toISOString() }).eq("id", existing.id);
    return NextResponse.json({ ok: true });
  }

  await db.from("Note").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    kind: "journal",
    title: today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    content: { type: "doc", content: [paragraph] },
    journalDate: today.toISOString(),
    updatedAt: now.toISOString(),
  });
  return NextResponse.json({ ok: true });
}
