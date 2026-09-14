"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { APP_NAME } from "@/lib/config";

/**
 * The centre: a wordmark and the one place you can just say what you want.
 *
 * It used to be a 264px sigil over a tagline over a quote, filling the tallest
 * column on the screen to say nothing you did not already know — you are
 * looking at SAGE; it does not need four lines and an illustration to tell you
 * so. All of that is gone. What is left is the name, set as a wordmark, and
 * the ask bar.
 *
 * The name is drawn in the brand face at weight 900 with the letters spaced
 * wide and a hard shadow behind them — an arcade marquee rather than a logo
 * treatment. It costs one line of type where the sigil cost a column, and the
 * space that frees goes to the panes, which is the point: every other pane
 * answers a question you did not ask, and this is the only part of the screen
 * that waits for you to ask one. It does not need to be the biggest thing on
 * it to be that.
 */

const CHIPS: { label: string; ask: string }[] = [
  { label: "Summarise today", ask: "Summarise my day so far — what happened and what still needs me." },
  { label: "What needs me", ask: "What are the most critical things needing my attention right now?" },
  { label: "Read my mail", ask: "What is in my mail that actually needs me, from both accounts?" },
  { label: "Draft report", ask: "Draft a short status report on where I am this week." },
];

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
      {/* aria-label so a screen reader gets the name once, not letter by
          letter as the spacing would otherwise have it read. */}
      <h2 className="deck-word" aria-label={APP_NAME}>
        <span aria-hidden>{APP_NAME}</span>
      </h2>

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
    </div>
  );
}
