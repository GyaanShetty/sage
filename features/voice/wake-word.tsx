"use client";

import { useEffect, useRef } from "react";
import { useShellStore } from "@/features/shell/store";

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function getRecognition(): RecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

// Matches "sage", "hey sage", "ok sage", "sage wake up".
const WAKE = /\b(?:hey |ok |okay )?sage\b/i;

/**
 * Always-listening wake word. When enabled (persisted in the shell store),
 * a low-cost continuous SpeechRecognition scans for "Sage" / "Hey Sage" and
 * fires the same `sage:engage-voice` event the mic button uses, so the user
 * can summon the live assistant hands-free. Auto-restarts on end (browsers
 * time recognition out), pauses while the tab is hidden or while a voice
 * session is already open, and stops entirely when toggled off.
 */
export function WakeWord() {
  const enabled = useShellStore((s) => s.wakeWord);
  const recRef = useRef<RecognitionLike | null>(null);
  const runningRef = useRef(false);
  const voiceOpenRef = useRef(false);

  useEffect(() => {
    // Track whether a voice session is already open so we don't double-fire.
    const onState = (e: Event) => {
      const s = (e as CustomEvent).detail as string;
      voiceOpenRef.current = s !== "off";
    };
    window.addEventListener("sage:voice-state", onState);
    return () => window.removeEventListener("sage:voice-state", onState);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const rec = getRecognition();
    if (!rec) return;
    recRef.current = rec;
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    const safeStart = () => {
      if (runningRef.current) return;
      try {
        rec.start();
        runningRef.current = true;
      } catch {
        /* already started */
      }
    };

    rec.onresult = (event) => {
      let text = "";
      const r = event.results;
      for (let i = 0; i < r.length; i++) text += r[i][0]?.transcript ?? "";
      if (WAKE.test(text) && !voiceOpenRef.current && document.visibilityState === "visible") {
        voiceOpenRef.current = true; // debounce until state event confirms
        window.dispatchEvent(new CustomEvent("sage:engage-voice"));
      }
    };
    rec.onend = () => {
      runningRef.current = false;
      // Restart unless a voice session grabbed the mic or the tab is hidden.
      if (!voiceOpenRef.current && document.visibilityState === "visible") {
        setTimeout(safeStart, 400);
      }
    };
    rec.onerror = () => {
      runningRef.current = false;
    };

    const onVis = () => {
      if (document.visibilityState === "visible") safeStart();
      else {
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);

    safeStart();

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      rec.onend = null;
      rec.onerror = null;
      rec.onresult = null;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
      runningRef.current = false;
    };
  }, [enabled]);

  return null;
}
