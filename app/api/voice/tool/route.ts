import { NextResponse } from "next/server";
import { buildDayPicture, describeDay } from "@/core/brief/agenda";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { fmt } from "@/lib/config";

/** Executes function calls made by the realtime voice session. */
export async function POST(req: Request) {
  const { name, args } = (await req.json()) as { name?: string; args?: Record<string, unknown> };
  if (!name) return NextResponse.json({ ok: false, error: "no tool name" }, { status: 400 });
  await ensureDefaultUser();

  try {
    switch (name) {
      case "create_task": {
        const title = String(args?.title ?? "").slice(0, 300);
        if (!title) return NextResponse.json({ ok: false, error: "empty title" });
        await db.from("Task").insert({
          id: crypto.randomUUID(),
          userId: DEFAULT_USER_ID,
          title,
          priority: 1,
          source: "voice",
          ...(args?.dueAt ? { dueAt: new Date(String(args.dueAt)).toISOString() } : {}),
        });
        return NextResponse.json({ ok: true, result: `Task created: ${title}` });
      }
      case "create_note": {
        const text = String(args?.text ?? "").slice(0, 2000);
        if (!text) return NextResponse.json({ ok: false, error: "empty note" });
        await db.from("Note").insert({
          id: crypto.randomUUID(),
          userId: DEFAULT_USER_ID,
          kind: "doc",
          title: text.slice(0, 60),
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
          updatedAt: new Date().toISOString(),
        });
        return NextResponse.json({ ok: true, result: "Noted." });
      }
      case "create_reminder": {
        const text = String(args?.text ?? "").slice(0, 300);
        const remindAt = args?.remindAt ? new Date(String(args.remindAt)) : null;
        if (!text || !remindAt || Number.isNaN(remindAt.getTime()))
          return NextResponse.json({ ok: false, error: "need text and a valid remindAt" });
        await db.from("Reminder").insert({
          id: crypto.randomUUID(),
          userId: DEFAULT_USER_ID,
          text,
          remindAt: remindAt.toISOString(),
          status: "pending",
        });
        return NextResponse.json({ ok: true, result: `Reminder set for ${fmt(remindAt, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` });
      }
      case "get_briefing": {
        // The same day picture the spoken brief reads from, so asking SAGE
        // "how's my day" out loud and letting it brief you on boot cannot
        // disagree with each other.
        const picture = await buildDayPicture();
        return NextResponse.json({ ok: true, result: describeDay(picture) });
      }
      default:
        return NextResponse.json({ ok: false, error: `unknown tool ${name}` });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "tool failed" });
  }
}
