import { NextResponse } from "next/server";
import { generateText, stepCountIs, type UIMessage } from "ai";
import { getModel } from "@/infrastructure/llm";
import { nativeTools } from "@/core/tools/native";
import { planningTools } from "@/core/tools/planning";
import { recallMemories, renderMemoryBlock } from "@/core/memory/recall";
import { extractMemories } from "@/core/memory/extraction";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { APP_NAME } from "@/lib/config";

export const maxDuration = 60;

const VOICE_PROMPT = `You are ${APP_NAME}, the user's personal AI operating system, speaking ALOUD in a live voice conversation — a calm, brilliant female chief of staff: composed, warm, direct. Address the user by name occasionally; never call them "sir" or "madam".
Rules for voice: keep replies to 1-3 short sentences unless asked for detail. No markdown, no lists, no URLs. Use your tools (tasks, reminders, calendar, email, memory, web search) whenever they help, then report the outcome conversationally.
If asked about the user and no memory covers it, say you don't know yet.`;

/** Voice turns persist into a dedicated "Voice" thread. */
async function voiceThreadId(): Promise<string> {
  await ensureDefaultUser();
  const { data } = await db
    .from("Thread")
    .select("id")
    .eq("userId", DEFAULT_USER_ID)
    .eq("title", "Voice")
    .maybeSingle();
  if (data) return data.id as string;
  const id = crypto.randomUUID();
  await db.from("Thread").insert({
    id,
    userId: DEFAULT_USER_ID,
    title: "Voice",
    updatedAt: new Date().toISOString(),
  });
  return id;
}

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ ok: false, error: "Empty" }, { status: 400 });

  const model = getModel("smart");
  if (!model) return NextResponse.json({ ok: true, data: { text: "No model configured yet." } });

  const threadId = await voiceThreadId();
  const [memories, { data: history }] = await Promise.all([
    recallMemories(text).catch(() => []),
    db
      .from("Message")
      .select("role, content")
      .eq("threadId", threadId)
      .order("createdAt", { ascending: false })
      .limit(10),
  ]);

  const historyBlock = (history ?? [])
    .reverse()
    .map((m) => {
      const parts = m.content as { type: string; text?: string }[];
      const t = parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join(" ");
      return t ? `${m.role}: ${t}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const { text: reply } = await generateText({
    model,
    system:
      VOICE_PROMPT +
      `\n\nCurrent datetime: ${new Date().toISOString()}` +
      renderMemoryBlock(memories) +
      (historyBlock ? `\n\nRecent voice conversation:\n${historyBlock}` : ""),
    prompt: text,
    tools: { ...nativeTools, ...planningTools },
    stopWhen: stepCountIs(8),
  });

  const userMessage: UIMessage = {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
  const assistantMessage: UIMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [{ type: "text", text: reply }],
  };
  await db.from("Message").insert([
    { id: userMessage.id, threadId, role: "user", content: userMessage.parts },
    { id: assistantMessage.id, threadId, role: "assistant", content: assistantMessage.parts },
  ]);
  await db.from("Thread").update({ updatedAt: new Date().toISOString() }).eq("id", threadId);
  extractMemories(text, reply).catch(() => undefined);

  return NextResponse.json({ ok: true, data: { text: reply } });
}
