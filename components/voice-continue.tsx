"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { speakRest } from "@/lib/speak";

/**
 * The rest of a long answer, one tap away.
 *
 * SAGE says a minute at a time and tells you how much is left. Saying "go on"
 * works, but it should not be the only way — a spoken command is the wrong
 * affordance in a quiet room, and asking someone to remember a magic phrase to
 * hear the end of a sentence is a poor trade.
 */
export function VoiceContinue() {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const onMore = (e: Event) => setRemaining((e as CustomEvent<{ remaining: number }>).detail?.remaining ?? 0);
    window.addEventListener("sage:voice-more", onMore);
    return () => window.removeEventListener("sage:voice-more", onMore);
  }, []);

  if (remaining <= 0) return null;

  return (
    <button
      onClick={() => void speakRest()}
      className="vc-continue"
      title="Hear the rest"
    >
      <ChevronRight className="size-3.5" />
      GO ON · {remaining} {remaining === 1 ? "PART" : "PARTS"} LEFT
    </button>
  );
}
