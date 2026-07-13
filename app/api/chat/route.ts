import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { getModel } from "@/infrastructure/llm";
import { APP_NAME } from "@/lib/config";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are ${APP_NAME}, a personal AI operating system — an intelligent chief of staff.
Be concise, warm, and direct. Prefer doing over explaining. Format with markdown when it helps.`;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const model = getModel("smart");
  if (!model) return mockResponse();

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}

/** Keyless dev mode: streams a canned reply so the full pipeline is testable. */
function mockResponse() {
  const text =
    "I'm running in **mock mode** — no LLM key is configured yet. " +
    "Add `GOOGLE_GENERATIVE_AI_API_KEY` to `.env.local` (free key from aistudio.google.com/apikey) and restart, " +
    "and I'll come alive. The streaming pipeline you're seeing right now is the real one.";

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
