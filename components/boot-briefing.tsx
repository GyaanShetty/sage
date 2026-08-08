"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { sound } from "@/lib/sound";
import { speakLowLatency } from "@/lib/speak";

/**
 * The spoken briefing — on request only.
 *
 * This used to run itself: a market debrief spoken aloud a second and a half
 * after the app loaded, armed to fire on your first tap if the browser blocked
 * autoplay. Opening SAGE to read one thing and being told about the Nifty is
 * not assistance, it is an interruption you did not schedule, and a voice that
 * interrupts is a voice you mute — after which it can tell you nothing at all.
 *
 * So nothing here speaks unless asked. It answers `sage:replay-brief`, which
 * is ⌘K → "Play morning brief" and the play button on the dashboard's brief
 * block. Given text it reads that instead, which is how an older briefing gets
 * replayed from the history list.
 */
export function BootBriefing() {
  const [caption, setCaption] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /** Speak a brief on demand. With no argument it fetches today's (without
   *  claiming it); given text it reads that instead, which is how an older
   *  briefing from the history list gets replayed. */
  const replay = useCallback(async (given?: string) => {
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    setNeedsTap(false);
    setCaption(given ?? "Pulling your briefing…");
    try {
      let text: string | null = given ?? null;
      if (!text) {
        const cfg = localStorage.getItem("sage-market-config");
        const indices = cfg ? (JSON.parse(cfg).indices as string[])?.join(",") : "^NSEI,^BSESN";
        const res = await fetch(`/api/brief/debrief?symbols=${encodeURIComponent(indices || "^NSEI,^BSESN")}`);
        text = (await res.json())?.data?.text ?? null;
      }
      if (!text) { setCaption("No briefing available right now."); setTimeout(() => setCaption(null), 4000); return; }
      setCaption(text);
      if (!sound.isOn()) { setTimeout(() => setCaption(null), 12_000); return; }
      // Replay is always triggered by a keystroke or click, so the audio
      // element is unlocked and this will not be refused.
      audioRef.current = await speakLowLatency(text, { fast: true, onended: () => setCaption(null) });
      if (!audioRef.current) setTimeout(() => setCaption(null), 12_000);
    } catch {
      setCaption(null);
    }
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      void replay(text);
    };
    window.addEventListener("sage:replay-brief", on);
    return () => window.removeEventListener("sage:replay-brief", on);
  }, [replay]);

  return (
    <AnimatePresence>
      {caption && (
        <motion.div
          className="debrief"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="debrief-eq" aria-hidden>
            <span /><span /><span /><span /><span />
          </div>
          <p className="debrief-text">{caption}</p>
          {needsTap && <p className="debrief-tap">TAP ANYWHERE TO HEAR THE BRIEFING</p>}
          <button className="debrief-x" onClick={() => setCaption(null)} aria-label="Dismiss briefing">✕</button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
