"use client";

/**
 * The one input.
 *
 * The old build had a voice overlay, a wake word, a radial wheel, a function
 * key rail, a launcher, a command palette and an AI console — seven ways to
 * say something to SAGE, which is six more than anyone can hold in their head.
 * This is the one that is always in the same place.
 *
 * Enter sends to chat. ⌘K still opens the palette for everything that is not a
 * question, which is the only other way in.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { APP_NAME } from "@/lib/config";

export function Ask() {
  const [q, setQ] = useState("");
  const router = useRouter();

  const send = () => {
    const text = q.trim();
    if (!text) return;
    router.push(`/chat?ask=${encodeURIComponent(text)}`);
  };

  return (
    <div className="ask">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        placeholder={`Ask ${APP_NAME} anything`}
        aria-label={`Ask ${APP_NAME}`}
      />
      {/* Appears once there is something to send, so the field is a field
          until it is a question. */}
      {q.trim() && (
        <button className="btn btn-accent" onClick={send} aria-label="Send">
          <ArrowRight className="size-4" />
        </button>
      )}
    </div>
  );
}
