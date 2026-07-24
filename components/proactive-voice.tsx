"use client";

import { useEffect, useRef } from "react";
import { sound } from "@/lib/sound";
import { hudHighlight } from "@/lib/hud";

interface Alert {
  level: "info" | "warn" | "high";
  icon: string;
  text: string;
}

const POLL_MS = 180_000; // check the situation every 3 minutes
const SEEN_KEY = "sage-proactive-seen";

/** Speak an alert aloud with SAGE's voice (neural TTS, browser fallback). */
async function speak(text: string): Promise<void> {
  try {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
      return;
    }
  } catch {
    /* fall through to browser synth */
  }
  const synth = window.speechSynthesis;
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(text);
  const v =
    synth.getVoices().find((x) => /en-GB/i.test(x.lang) && /male|daniel|george|arthur/i.test(x.name)) ??
    synth.getVoices().find((x) => /en-GB/i.test(x.lang)) ??
    null;
  if (v) u.voice = v;
  u.rate = 0.96;
  u.pitch = 0.8;
  synth.speak(u);
}

/**
 * Proactive presence: SAGE watches the situation report and, when something
 * important newly appears (a high-severity alert), says it ALOUD once and
 * lights up the SITREP panel — instead of silently rendering a chip. This is
 * the biggest single step toward the JARVIS feel: it speaks up on its own.
 *
 * Guards: only "high" alerts, deduped by text for the day, never speaks while
 * muted or while a voice session is active, and waits for a first interaction
 * so browsers permit audio.
 */
export function ProactiveVoice() {
  const armed = useRef(false);
  const voiceOpen = useRef(false);

  useEffect(() => {
    // Arm on first interaction so audio autoplay is permitted.
    const arm = () => {
      armed.current = true;
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { once: true, passive: true }));

    const onVoice = (e: Event) => {
      voiceOpen.current = (e as CustomEvent).detail !== "off";
    };
    window.addEventListener("sage:voice-state", onVoice);

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const readSeen = (): Record<string, string> => {
      try {
        const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
        return raw?.day === today ? raw.items ?? {} : {};
      } catch {
        return {};
      }
    };
    const writeSeen = (items: Record<string, string>) => {
      localStorage.setItem(SEEN_KEY, JSON.stringify({ day: today, items }));
    };

    let first = true;
    const check = async () => {
      if (!armed.current || voiceOpen.current || !sound.isOn()) return;
      try {
        const j = await fetch("/api/sitrep").then((r) => r.json());
        const alerts: Alert[] = j?.data ?? [];
        const high = alerts.filter((a) => a.level === "high");
        if (!high.length) return;
        const seen = readSeen();
        const fresh = high.filter((a) => !seen[a.text]);
        // On the very first poll of a session, don't dump the backlog — just
        // remember what's already there so we only announce genuinely new items.
        if (first) {
          high.forEach((a) => (seen[a.text] = "1"));
          writeSeen(seen);
          first = false;
          return;
        }
        if (!fresh.length) return;
        const a = fresh[0];
        seen[a.text] = "1";
        writeSeen(seen);
        hudHighlight("sitrep");
        await speak(`Sir — ${a.text.replace(/^[^a-zA-Z0-9]+/, "")}`);
      } catch {
        /* offline; try again next tick */
      }
    };

    const t = window.setInterval(check, POLL_MS);
    const kick = window.setTimeout(check, 8000); // shortly after boot
    return () => {
      window.clearInterval(t);
      window.clearTimeout(kick);
      events.forEach((e) => window.removeEventListener(e, arm));
      window.removeEventListener("sage:voice-state", onVoice);
    };
  }, []);

  return null;
}
