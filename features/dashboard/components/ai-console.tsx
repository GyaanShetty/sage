"use client";

/**
 * The console: one prompt, four openings, and a line in.
 *
 * SAGE already has an ask bar on the deck hero and a chat page. This is
 * neither a third conversation nor a copy of the second — every route here
 * lands in /chat with the question already asked, so there is one transcript
 * and one place it lives. A panel that held its own separate history would be
 * the fifth way to talk to SAGE and the fourth place to lose what was said.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SendHorizonal, Sparkles, Newspaper, LineChart, FileText } from "lucide-react";
import { Pane } from "@/components/pane";
import { sound } from "@/lib/sound";

const OPENINGS = [
  { icon: LineChart, label: "Analyze market trends", ask: "Analyse what moved in the markets today and what it means for my positions." },
  { icon: Sparkles, label: "Research a topic", ask: "Research a topic for me — ask me which one, then go deep and cite sources." },
  { icon: Newspaper, label: "Summarize latest news", ask: "Summarise the news that actually matters to me today, and say why each one does." },
  { icon: FileText, label: "Generate a report", ask: "Draft a short status report on where I am this week." },
];

export function AiConsole({ n }: { n?: number }) {
  const [text, setText] = useState("");
  const router = useRouter();

  const send = (q: string) => {
    const ask = q.trim();
    if (!ask) return;
    sound.blip();
    router.push(`/chat?ask=${encodeURIComponent(ask)}`);
  };

  return (
    <Pane n={n} title="AI Console" status="ONLINE" live noZoom>
      <div className="aic">
        <p className="aic-q">How can I help you today?</p>

        <div className="aic-grid">
          {OPENINGS.map((o) => (
            <button key={o.label} onClick={() => send(o.ask)} onPointerEnter={() => sound.hover()}>
              <o.icon className="size-3.5" strokeWidth={1.5} aria-hidden />
              <span>{o.label}</span>
            </button>
          ))}
        </div>

        <form className="aic-in" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message SAGE…"
            aria-label="Message SAGE"
          />
          <button type="submit" aria-label="Send" disabled={!text.trim()}>
            <SendHorizonal className="size-4" strokeWidth={1.6} />
          </button>
        </form>
      </div>
    </Pane>
  );
}
