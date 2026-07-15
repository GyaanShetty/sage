import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const maxDuration = 60;

/** Daily AI brief: generated once per ~6h window, cached in the event log. */
export async function GET() {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: cached } = await db
    .from("Event")
    .select("payload, createdAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "brief.generated")
    .gte("createdAt", since)
    .order("createdAt", { ascending: false })
    .limit(1);
  if (cached?.length) {
    return NextResponse.json({ ok: true, data: { text: (cached[0].payload as { text: string }).text, cached: true } });
  }

  const model = getModel("fast");
  if (!model) return NextResponse.json({ ok: true, data: { text: null } });

  const [{ data: tasks }, { data: reminders }, { data: goals }] = await Promise.all([
    db
      .from("Task")
      .select("title, dueAt, priority")
      .eq("userId", DEFAULT_USER_ID)
      .in("status", ["todo", "doing"])
      .order("priority")
      .limit(10),
    db
      .from("Reminder")
      .select("text, remindAt")
      .eq("userId", DEFAULT_USER_ID)
      .eq("status", "pending")
      .order("remindAt")
      .limit(5),
    db
      .from("Memory")
      .select("content")
      .eq("userId", DEFAULT_USER_ID)
      .eq("type", "goal")
      .is("supersededBy", null)
      .order("importance", { ascending: false })
      .limit(3),
  ]);

  const { text } = await generateText({
    model,
    prompt: `You are SAGE, the user's chief of staff. Write a 2-3 sentence brief. Warm, direct, no fluff, no headers, no lists, and do NOT start with a greeting like "Good morning" — jump straight into what matters most right now. If there's little to report, say so gracefully.

Now: ${new Date().toString()}
Open tasks: ${JSON.stringify(tasks ?? [])}
Pending reminders: ${JSON.stringify(reminders ?? [])}
Their goals: ${JSON.stringify(goals?.map((g) => g.content) ?? [])}`,
  });

  await db.from("Event").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    type: "brief.generated",
    payload: { text },
  });

  return NextResponse.json({ ok: true, data: { text, cached: false } });
}
