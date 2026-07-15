"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Mic } from "lucide-react";
import { useVoice } from "@/features/voice/use-voice";
import { cn } from "@/lib/utils";
import { fadeRise } from "@/lib/motion";
import { APP_NAME } from "@/lib/config";
import { TypingIndicator } from "./typing-indicator";
import { Markdown } from "./markdown";
import { ToolCard } from "./tool-card";
import { PlanChecklist, type PlanState } from "./plan-checklist";
import type { UIMessage as UIMessageType } from "ai";

/** Reconstruct the latest plan state from a message's tool parts. */
function planFromParts(message: UIMessageType): PlanState | null {
  let plan: PlanState | null = null;
  for (const part of message.parts) {
    const p = part as unknown as { type: string; state?: string; input?: unknown; output?: unknown };
    if (p.type === "tool-set_plan" && p.input) {
      const input = p.input as { goal?: string; steps?: string[] };
      if (input.steps) {
        plan = { goal: input.goal ?? "Plan", steps: input.steps.map((title) => ({ title, done: false })) };
      }
    }
    if (p.type === "tool-complete_step" && plan && p.input) {
      const input = p.input as { stepIndex?: number };
      if (typeof input.stepIndex === "number" && plan.steps[input.stepIndex]) {
        plan.steps[input.stepIndex].done = true;
      }
    }
  }
  return plan;
}

export function ChatView({
  threadId,
  initialMessages,
  initialAsk,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  initialAsk?: string;
}) {
  const voiceMode = useRef(false);
  const { messages, sendMessage, status } = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { threadId } }),
    onFinish: ({ message }) => {
      if (!voiceMode.current) return;
      voiceMode.current = false;
      const text = message.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ");
      if (text) voice.speak(text);
    },
  });

  const voice = useVoice({
    onTranscript: (text) => {
      voiceMode.current = true;
      sendMessage({ text });
    },
  });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Palette "Ask" handoff: trailing space means pre-fill only, else auto-send.
  const askHandled = useRef(false);
  useEffect(() => {
    if (!initialAsk || askHandled.current) return;
    askHandled.current = true;
    if (initialAsk.endsWith(" ")) setInput(initialAsk);
    else sendMessage({ text: initialAsk });
    window.history.replaceState(null, "", `/chat?t=${threadId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAsk]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    sendMessage({ text });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {messages.length === 0 && (
            <motion.div
              variants={fadeRise}
              initial="hidden"
              animate="visible"
              className="flex h-[60vh] flex-col items-center justify-center text-center"
            >
              <div className="size-10 rounded-xl bg-accent/90 shadow-[0_0_28px_var(--accent-glow)]" />
              <h1 className="mt-6 text-xl font-semibold tracking-tight">
                What can I do for you?
              </h1>
              <p className="mt-1.5 text-sm text-subtle">
                Ask anything — {APP_NAME} remembers what matters.
              </p>
            </motion.div>
          )}

          <div className="flex flex-col gap-6">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "text-[15px] leading-relaxed",
                    message.role === "user"
                      ? "ml-auto max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-border-glass bg-glass-strong px-4 py-2.5"
                      : "max-w-none",
                  )}
                >
                  {(() => {
                    const plan = planFromParts(message);
                    return plan ? <PlanChecklist plan={plan} /> : null;
                  })()}
                  {message.parts.map((part, i) => {
                    if (part.type === "tool-set_plan" || part.type === "tool-complete_step") {
                      return null; // rendered via PlanChecklist
                    }
                    if (part.type === "text") {
                      return message.role === "assistant" ? (
                        <Markdown key={i}>{part.text}</Markdown>
                      ) : (
                        <span key={i}>{part.text}</span>
                      );
                    }
                    if (part.type.startsWith("tool-")) {
                      const toolPart = part as unknown as {
                        state: string;
                        output?: unknown;
                      };
                      return (
                        <ToolCard
                          key={i}
                          name={part.type.slice(5)}
                          state={toolPart.state}
                          output={toolPart.output}
                        />
                      );
                    }
                    return null;
                  })}
                </motion.div>
              ))}
            </AnimatePresence>
            {status === "submitted" && <TypingIndicator />}
          </div>
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border-glass bg-black/60 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <div className="flex items-end gap-2 rounded-xl border border-border-glass bg-glass px-4 py-3 transition-colors focus-within:border-border-glass-strong">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder={`Message ${APP_NAME}…`}
              className="max-h-40 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-subtle"
            />
            {voice.supported && (
              <button
                onClick={() => (voice.listening ? voice.stop() : (voice.stopSpeaking(), voice.start()))}
                aria-label={voice.listening ? "Stop listening" : "Speak"}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg transition-all",
                  voice.listening
                    ? "bg-red-500/90 text-white shadow-[0_0_16px_rgba(239,68,68,0.4)] animate-pulse"
                    : "bg-glass-strong text-subtle hover:text-foreground",
                )}
              >
                <Mic className="size-4" strokeWidth={2} />
              </button>
            )}
            <button
              onClick={submit}
              disabled={!input.trim() || busy}
              aria-label="Send"
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg transition-all",
                input.trim() && !busy
                  ? "bg-accent text-white shadow-[0_0_16px_var(--accent-glow)]"
                  : "bg-glass-strong text-subtle",
              )}
            >
              <ArrowUp className="size-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
