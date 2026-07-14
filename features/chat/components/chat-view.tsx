"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeRise } from "@/lib/motion";
import { APP_NAME } from "@/lib/config";
import { TypingIndicator } from "./typing-indicator";
import { Markdown } from "./markdown";
import { ToolCard } from "./tool-card";

export function ChatView({
  threadId,
  initialMessages,
  initialAsk,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  initialAsk?: string;
}) {
  const { messages, sendMessage, status } = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { threadId } }),
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
                  {message.parts.map((part, i) => {
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
