import { generateText, stepCountIs, type UIMessage } from "ai";
import { getModel } from "@/infrastructure/llm";
import { nativeTools } from "@/core/tools/native";
import { planningTools } from "@/core/tools/planning";
import { domainTools } from "@/core/tools/domain";
import { recallWithin, renderMemoryBlock } from "@/core/memory/recall";
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
  return (await runVoiceTurnDetailed(text, mood)).text;
}

/**
 * The same turn, also reporting which tools ran, so the panel can show what
 * SAGE actually did rather than only what it said it did.
 */
export async function runVoiceTurnDetailed(
  text: string,
  mood: Mood = "playful",
): Promise<{ text: string; actions: string[] }> {
  const model = getModel("fast");
  if (!model) return { text: "No model configured yet.", actions: [] };

  const threadId = await voiceThreadId();
  const [memories, { data: history }] = await Promise.all([
    // On a deadline: in a spoken turn, a second of silence waiting on recall
    // is a second of him wondering whether SAGE heard him at all.
    recallWithin(text),
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

  // Voice used to get the native pack only, capped at three steps — so asking
  // it about the pipeline, the portfolio, spending or its own automations got
  // a guess rather than a lookup. It now has the same reach as the chat page:
  // every tool, and enough steps to look something up and then act on it.
  const tools = { ...nativeTools, ...planningTools, ...domainTools };
  const run = (m: NonNullable<ReturnType<typeof getModel>>) =>
    generateText({ model: m, system, prompt: text, tools, stopWhen: stepCountIs(8) });

  let reply: string;
  let steps: Awaited<ReturnType<typeof run>>["steps"] = [];
  try {
    ({ text: reply, steps } = await run(model));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const quotaHit = /quota|429|RESOURCE_EXHAUSTED/i.test(msg);
    const backup = getModel("smart");
    if (quotaHit && backup) {
      try {
        ({ text: reply, steps } = await run(backup));
      } catch {
        return { text: QUOTA_MSG, actions: [] };
      }
    } else if (quotaHit) {
      return { text: QUOTA_MSG, actions: [] };
    } else {
      throw err;
    }
  }

  // A turn can end on a tool call with no words after it — the model looked
  // something up and then said nothing. Down the voice path that is silence,
  // which is indistinguishable from a crash. Ask once more, without tools, so
  // it has to answer in words using what it already found.
  if (!reply?.trim()) {
    const findings = steps
      .flatMap((st) => (st.content ?? []) as { type?: string; output?: unknown; toolName?: string }[])
      .filter((c) => c.type === "tool-result")
      .map((c) => `${c.toolName}: ${JSON.stringify(c.output).slice(0, 1500)}`)
      .join("\n");
    try {
      const { text: retry } = await generateText({
        model,
        system,
        prompt: findings
          ? `${text}\n\nYou already looked this up:\n${findings}\n\nAnswer him out loud now, in one to three spoken sentences.`
          : text,
      });
      reply = retry;
    } catch { /* fall through to the guard below */ }
  }
  if (!reply?.trim()) reply = "I looked, sir, but I'm having trouble putting it into words just now.";

  const userMessage: UIMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
  const assistantMessage: UIMessage = { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: reply }] };
  await db.from("Message").insert([
    { id: userMessage.id, threadId, role: "user", content: userMessage.parts },
    { id: assistantMessage.id, threadId, role: "assistant", content: assistantMessage.parts },
  ]);
  await db.from("Thread").update({ updatedAt: new Date().toISOString() }).eq("id", threadId);
  extractMemories(text, reply).catch(() => undefined);

  // Names only. Arguments can carry personal detail and this is rendered on
  // screen, so the strip says *that* SAGE looked something up, not what.
  const actions = steps.flatMap((s) => (s.toolCalls ?? []).map((c) => c.toolName));

  return { text: reply, actions };
}
