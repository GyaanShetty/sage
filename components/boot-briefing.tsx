"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { sound } from "@/lib/sound";

/**
 * Spoken JARVIS-style debrief once per session, just after the boot
 * sequence. Fetches the briefing script, speaks it via neural TTS (browser
 * voice fallback), and shows a live caption. Because browsers block audio
 * without a gesture, if playback is refused we arm it to fire on the first
 * tap and show a subtle prompt.
 */
export function BootBriefing() {
  const [caption, setCaption] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("sage-debriefed")) return;
      sessionStorage.setItem("sage-debriefed", "1");
    } catch {}
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;

    const speakBrowser = (text: string) => {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const u = new SpeechSynthesisUtterance(text);
      const pick = () => {
        const vs = synth.getVoices();
        return (
          vs.find((v) => /en-GB/i.test(v.lang) && /male|daniel|george|arthur|oliver/i.test(v.name)) ??
          vs.find((v) => v.name === "Google UK English Male") ??
          vs.find((v) => /en-GB/i.test(v.lang)) ??
          vs.find((v) => /^en/i.test(v.lang)) ??
          null
        );
      };
      const v = pick();
      if (v) u.voice = v;
      u.rate = 0.94;
      u.pitch = 0.78; // deeper
      u.onend = () => !cancelled && setCaption(null);
      synth.speak(u);
    };

    const run = async () => {
      if (startedRef.current) return;
      startedRef.current = true;
      try {
        const cfg = localStorage.getItem("sage-market-config");
        const indices = cfg ? (JSON.parse(cfg).indices as string[])?.join(",") : "^NSEI,^BSESN";
        const res = await fetch(`/api/brief/debrief?symbols=${encodeURIComponent(indices || "^NSEI,^BSESN")}`);
        const json = await res.json();
        const text: string | null = json?.data?.text ?? null;
        if (!text || cancelled) return;
        setCaption(text);

        if (!sound.isOn()) {
          // Muted: show the caption for a beat, no audio.
          setTimeout(() => !cancelled && setCaption(null), 9000);
          return;
        }

        // Neural TTS first.
        let played = false;
        try {
          const tts = await fetch("/api/voice/speak", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (tts.ok && !cancelled) {
            const url = URL.createObjectURL(await tts.blob());
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => { setCaption(null); URL.revokeObjectURL(url); };
            await audio.play();
            played = true;
          }
        } catch {
          played = false;
        }
        if (!played && !cancelled) {
          // Try browser synthesis; if that path is also gesture-gated, prompt.
          try {
            speakBrowser(text);
          } catch {
            setNeedsTap(true);
          }
        }
      } catch {
        setCaption(null);
      }
    };

    // Arm playback on first tap in case autoplay is blocked.
    const onTap = () => {
      if (audioRef.current && audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      }
      setNeedsTap(false);
    };
    window.addEventListener("pointerdown", onTap);

    // Start after the boot sequence has had its moment.
    const t = setTimeout(run, 2600);

    return () => {
      cancelled = true;
      clearTimeout(t);
      window.removeEventListener("pointerdown", onTap);
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
    };
  }, []);

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
