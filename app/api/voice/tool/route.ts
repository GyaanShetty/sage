import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { listUpcomingEvents, listUnreadEmails } from "@/infrastructure/integrations/google";
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
        const [{ data: tasks }, events, emails] = await Promise.all([
          db
            .from("Task")
            .select("title, status, dueAt")
            .eq("userId", DEFAULT_USER_ID)
            .neq("status", "done")
            .neq("status", "cancelled")
            .order("priority", { ascending: true })
            .limit(8),
          listUpcomingEvents(5).catch(() => null),
          listUnreadEmails(3).catch(() => null),
        ]);
        return NextResponse.json({
          ok: true,
          result: {
            openTasks: (tasks ?? []).map((t) => t.title),
            calendar: (events ?? []).map((e) => `${e.summary} at ${e.start}`),
            unreadEmail: (emails ?? []).map((e) => `${e.from}: ${e.subject}`),
          },
        });
      }
      default:
        return NextResponse.json({ ok: false, error: `unknown tool ${name}` });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "tool failed" });
  }
}
