"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { speakRest } from "@/lib/speak";

/**
 * Skip to the next part of a long answer.
 *
 * A long answer plays its parts back to back on its own now, so this is no
 * longer how you hear the rest — it is how you stop waiting through the part
 * you are in. It doubles as the honest indicator of how much is left, which is
 * worth having on screen while SAGE talks.
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
      title="Skip to the next part"
    >
      <ChevronRight className="size-3.5" />
      SKIP · {remaining} {remaining === 1 ? "PART" : "PARTS"} LEFT
    </button>
  );
}
