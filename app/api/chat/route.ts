import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { nativeTools } from "@/core/tools/native";
import { getModel } from "@/infrastructure/llm";
import {
  getThreadSummary,
  maybeTitleThread,
  saveExchange,
  setThreadSummary,
} from "@/infrastructure/db/threads";
import { generateText } from "ai";
import { recallMemories, renderMemoryBlock, touchMemories } from "@/core/memory/recall";
import { extractMemories } from "@/core/memory/extraction";
import { APP_NAME } from "@/lib/config";

export const maxDuration = 120;

const SYSTEM_PROMPT = `You are ${APP_NAME}, a personal AI operating system — an intelligent chief of staff.
Be concise, warm, and direct. Prefer doing over explaining. Format with markdown when it helps.
You have long-term memory: when relevant memories are provided below, weave them in naturally.
If asked about the user and no memory covers it, say you don't know yet — never invent details about them.`;

function textOf(message: UIMessage | undefined): string {
  return (
    message?.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n") ?? ""
  );
}

export async function POST(req: Request) {
  const { messages, threadId }: { messages: UIMessage[]; threadId?: string } = await req.json();

  const model = getModel("smart");
  if (!model) return mockResponse();

  const userMessage = messages.findLast((m) => m.role === "user");
  const userText = textOf(userMessage);

  const memories = await recallMemories(userText).catch(() => []);
  void touchMemories(memories.map((m) => m.id));

  // Context compression: long threads send a rolling summary + recent window
  // instead of the full history.
  let contextMessages = messages;
  let summaryBlock = "";
  if (messages.length > 24 && threadId) {
    const summary = await getThreadSummary(threadId).catch(() => null);
    if (summary) summaryBlock = `\n\nEarlier in this conversation (summary):\n${summary}`;
    contextMessages = messages.slice(-16);
  }

  const nowBlock = `\n\nCurrent datetime: ${new Date().toISOString()}`;

  const result = streamText({
    model,
    system: SYSTEM_PROMPT + nowBlock + renderMemoryBlock(memories) + summaryBlock,
    messages: await convertToModelMessages(contextMessages),
    tools: nativeTools,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ responseMessage }) => {
      if (!threadId || !userMessage) return;
      await saveExchange(threadId, userMessage, responseMessage).catch(() => undefined);
      if (messages.length <= 1) await maybeTitleThread(threadId, userText).catch(() => undefined);
      await extractMemories(userText, textOf(responseMessage)).catch(() => undefined);
      // Refresh the rolling summary every ~10 messages
      if (messages.length > 20 && messages.length % 10 < 2) {
        await updateSummary(threadId, messages, textOf(responseMessage)).catch(() => undefined);
      }
    },
  });
}

async function updateSummary(threadId: string, messages: UIMessage[], lastReply: string) {
  const model = getModel("fast");
  if (!model) return;
  const prior = await getThreadSummary(threadId);
  const transcript = messages
    .slice(-20)
    .map((m) => `${m.role}: ${textOf(m).slice(0, 500)}`)
    .join("\n");
  const { text } = await generateText({
    model,
    prompt: `Update this running conversation summary. Keep it under 200 words, dense, factual.\n\nPrevious summary:\n${prior ?? "(none)"}\n\nRecent messages:\n${transcript}\nassistant: ${lastReply.slice(0, 500)}\n\nUpdated summary:`,
  });
  if (text) await setThreadSummary(threadId, text.trim());
}

/** Keyless dev mode: streams a canned reply so the full pipeline is testable. */
function mockResponse() {
  const text =
    "I'm running in **mock mode** — no LLM key is configured. " +
    "Add `GOOGLE_GENERATIVE_AI_API_KEY` to `.env.local` and restart.";

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const id = "mock-text";
      writer.write({ type: "text-start", id });
      for (const word of text.split(/(?<= )/)) {
        writer.write({ type: "text-delta", id, delta: word });
        await new Promise((r) => setTimeout(r, 25));
      }
      writer.write({ type: "text-end", id });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
