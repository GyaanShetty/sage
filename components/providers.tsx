"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { startTilt } from "@/lib/tilt";
import { startOverflowWatch } from "@/lib/overflow";
import { unlockAudio } from "@/lib/sound";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );

  // One pointer listener for every keycard on the page, started once here
  // rather than per pane. Idempotent, and a no-op under reduced motion.
  useEffect(() => startTilt(), []);

  // Which panes genuinely have content below the fold. Drives the fade, which
  // must never sit over content that fits.
  useEffect(() => startOverflowWatch(), []);

  // A browser hands out a SUSPENDED AudioContext and only lets it run after a
  // real gesture. Nothing resumed it on one, so every cue was silent until
  // something happened to call resume() mid-playback — by which time the
  // sound it was for had already been scheduled and lost.
  useEffect(() => unlockAudio(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </QueryClientProvider>
  );
}
