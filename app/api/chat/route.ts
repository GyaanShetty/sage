import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { getModel } from "@/infrastructure/llm";
import { saveExchange } from "@/infrastructure/db/threads";
import { recallMemories, renderMemoryBlock, touchMemories } from "@/core/memory/recall";
import { extractMemories } from "@/core/memory/extraction";
import { APP_NAME } from "@/lib/config";

export const maxDuration = 120;

const SYSTEM_PROMPT = `You are ${APP_NAME}, a personal AI operating system — an intelligent chief of staff.
Be concise, warm, and direct. Prefer doing over explaining. Format with markdown when it helps.
You have long-term memory: when relevant memories are provided below, weave them in naturally.`;

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

  const result = streamText({
    model,
    system: SYSTEM_PROMPT + renderMemoryBlock(memories),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ responseMessage }) => {
      if (!threadId || !userMessage) return;
      await saveExchange(threadId, userMessage, responseMessage).catch(() => undefined);
      await extractMemories(userText, textOf(responseMessage)).catch(() => undefined);
    },
  });
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
