"use client";

/**
 * Chat.
 *
 * The transport is unchanged — /api/chat, the same streaming, the same tools,
 * the same memory recall in front of it. What goes is the terminal dress it
 * was wearing: the "QUERY" / "SAGE" speaker tags in tracked uppercase, the
 * "AI ENGINE READY · MEMORY RECALL ARMED · TOOLS AVAILABLE" boot list, the
 * session rail and the `>` prompt glyph. None of it was information.
 *
 * What is left is the shape every messaging surface has, because it is the
 * shape that works: your turns on the right, its turns on the left, and a
 * field at the bottom that is always in the same place.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp } from "lucide-react";
import { Frame } from "@/features/home/frame";
import { Markdown } from "./components/markdown";
import { APP_NAME } from "@/lib/config";

/** The text of a turn, whatever parts the SDK split it into. */
function textOf(m: UIMessage): string {
  return (m.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function ChatPage({ threadId }: { threadId: string }) {
  const params = useSearchParams();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const sentOpening = useRef(false);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat", body: { threadId } }),
  });

  /*
   * The home page sends you here with ?ask=…, so the question you typed there
   * is asked rather than merely carried. Guarded by a ref because this effect
   * reruns on every status change and a question asked twice is a bill paid
   * twice.
   */
  useEffect(() => {
    const ask = params.get("ask");
    if (!ask || sentOpening.current) return;
    sentOpening.current = true;
    void sendMessage({ text: ask });
  }, [params, sendMessage]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, status]);

  const send = () => {
    const t = draft.trim();
    if (!t || status === "streaming") return;
    setDraft("");
    void sendMessage({ text: t });
  };

  return (
    <Frame title="Chat">
      <div className="chat">
        {messages.length === 0 && (
          <p className="quiet">Ask anything. {APP_NAME} reads what it already knows about you first.</p>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`turn ${m.role === "user" ? "mine" : "theirs"}`}>
            {m.role === "user"
              ? <p className="bubble">{textOf(m)}</p>
              : <div className="said"><Markdown>{textOf(m)}</Markdown></div>}
          </div>
        ))}

        {status === "streaming" && <div className="turn theirs"><span className="dots" aria-label="Thinking">···</span></div>}
        <div ref={endRef} />
      </div>

      <div className="ask chat-ask">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder={`Ask ${APP_NAME}`}
          aria-label="Message"
        />
        {draft.trim() && (
          <button className="btn btn-accent" onClick={send} aria-label="Send"><ArrowUp className="size-4" /></button>
        )}
      </div>
    </Frame>
  );
}
