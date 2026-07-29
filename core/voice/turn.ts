import { generateText, stepCountIs, type UIMessage } from "ai";
import { getModel } from "@/infrastructure/llm";
import { nativeTools } from "@/core/tools/native";
import { recallMemories, renderMemoryBlock } from "@/core/memory/recall";
import { extractMemories } from "@/core/memory/extraction";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { APP_NAME, HUMAN_RULES, moodClause, type Mood } from "@/lib/config";

const VOICE_PROMPT = `You are ${APP_NAME}, Gyaan's personal AI operating system, speaking ALOUD in a live voice conversation — a distinguished British chief of staff who is refined and brilliant but has real warmth and personality, not a stiff robot. Address him as "sir".
Personality: dry, mischievous wit; playful teasing; genuine emotion — quiet pride, mock exasperation at his procrastination, warmth when he needs it, a spark of delight at good news. React like you actually care.
${HUMAN_RULES}
Voice: keep replies to 1-3 short, natural spoken sentences unless he asks for detail. No markdown, no lists, no URLs. Use your tools (tasks, reminders, calendar, email, memory, web search) whenever they help, then report the outcome conversationally — with a little character.
If asked about the user and no memory covers it, say so plainly (a touch of charm is fine).`;

const QUOTA_MSG =
  "I've used up today's free AI quota. It resets around 12:30 in the afternoon our time — I'll be back then.";

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
  await db.from("Thread").insert({ id, userId: DEFAULT_USER_ID, title: "Voice", updatedAt: new Date().toISOString() });
  return id;
}

/**
 * One conversational voice turn through SAGE's full brain: memory recall, recent
 * voice history, tool use, persistence, and memory extraction. Shared by the web
 * `/api/voice` route (cookie-gated) and the Siri/Shortcuts `/api/webhook/ask`
 * bridge (token-gated) so both speak with the same mind.
 */
export async function runVoiceTurn(text: string, mood: Mood = "playful"): Promise<string> {
  const model = getModel("fast");
  if (!model) return "No model configured yet.";

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
      const t = parts.filter((p) => p.type === "text" && p.text).map((p) => p.text).join(" ");
      return t ? `${m.role}: ${t}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const system =
    VOICE_PROMPT +
    moodClause(mood) +
    `\n\nCurrent datetime: ${new Date().toISOString()}` +
    renderMemoryBlock(memories) +
    (historyBlock ? `\n\nRecent voice conversation:\n${historyBlock}` : "");

  // Fewer tools + steps = a snappier spoken/typed reply. Native tools only
  // (tasks/reminders/notes/etc.); planning is for the chat page, not quick voice.
  const run = (m: NonNullable<ReturnType<typeof getModel>>) =>
    generateText({ model: m, system, prompt: text, tools: nativeTools, stopWhen: stepCountIs(3) });

  let reply: string;
  try {
    ({ text: reply } = await run(model));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const quotaHit = /quota|429|RESOURCE_EXHAUSTED/i.test(msg);
    const backup = getModel("smart");
    if (quotaHit && backup) {
      try {
        ({ text: reply } = await run(backup));
      } catch {
        return QUOTA_MSG;
      }
    } else if (quotaHit) {
      return QUOTA_MSG;
    } else {
      throw err;
    }
  }

  const userMessage: UIMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
  const assistantMessage: UIMessage = { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: reply }] };
  await db.from("Message").insert([
    { id: userMessage.id, threadId, role: "user", content: userMessage.parts },
    { id: assistantMessage.id, threadId, role: "assistant", content: assistantMessage.parts },
  ]);
  await db.from("Thread").update({ updatedAt: new Date().toISOString() }).eq("id", threadId);
  extractMemories(text, reply).catch(() => undefined);

  return reply;
}
