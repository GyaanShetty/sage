"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SageSigil } from "@/components/ui/sage-sigil";
import { APP_NAME } from "@/lib/config";

/**
 * The centre column: the mark, and the one place you can just say what you
 * want.
 *
 * Every other pane on this screen answers a question you did not ask — the
 * markets moved, a task is due, an agent finished. This column is the
 * opposite: it is the only part of the dashboard that waits for you. That is
 * why it gets the mark and the space, and why the chips are verbs rather than
 * destinations.
 */

const CHIPS: { label: string; ask: string }[] = [
  { label: "Summarise today", ask: "Summarise my day so far — what happened and what still needs me." },
  { label: "What needs me", ask: "What are the most critical things needing my attention right now?" },
  { label: "Read my mail", ask: "What is in my mail that actually needs me, from both accounts?" },
  { label: "Draft report", ask: "Draft a short status report on where I am this week." },
];

const QUOTE = {
  line: "Information is abundant. Clarity is rare.",
  tail: "Let's find what matters.",
};

export function DeckHero() {
  const [ask, setAsk] = useState("");
  const router = useRouter();

  const send = (text: string) => {
    const q = text.trim();
    if (!q) return;
    // Straight into the conversation with the question already asked, rather
    // than into an empty chat he then has to retype it into.
    router.push(`/chat?ask=${encodeURIComponent(q)}`);
  };

  return (
    <div className="deck-hero">
      <SageSigil size={264} className="deck-sigil" />

      <div className="deck-id">
        <h2>{APP_NAME}</h2>
        <p>Your operational assistant</p>
      </div>

      <form
        className="deck-ask"
        onSubmit={(e) => { e.preventDefault(); send(ask); }}
      >
        <span className="deck-ask-wave" aria-hidden>
          <i /><i /><i /><i /><i />
        </span>
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="How can I help, today?"
          aria-label="Ask SAGE"
        />
        <button type="submit" aria-label="Ask">
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </button>
      </form>

      <div className="deck-chips">
        {CHIPS.map((c) => (
          <button key={c.label} onClick={() => send(c.ask)}>{c.label}</button>
        ))}
      </div>

      <blockquote className="deck-quote">
        <span className="q" aria-hidden>&ldquo;</span>
        <em>{QUOTE.line}</em>
        <b>{QUOTE.tail}</b>
        <span className="q r" aria-hidden>&rdquo;</span>
      </blockquote>
    </div>
  );
}
