"use client";

import { useEffect, useRef } from "react";
import { sound } from "@/lib/sound";
import { hudHighlight } from "@/lib/hud";
import { speakLowLatency, isSpeaking } from "@/lib/speak";

/**
 * The ambient voice — across everything, not just the markets.
 *
 * The previous version spoke only price moves, and not by design: it filtered
 * for high-urgency items, the only source that marked anything high was the
 * anomaly detector, and anomalies are mostly coins moving. One accidental path
 * was open and it made SAGE sound like a ticker.
 *
 * /api/ambient now gathers from the calendar, tasks, exams, budget, health,
 * study, decisions and the night shift as well, ranked by what it costs to
 * miss the thing. A meeting in ten minutes outranks a coin, always.
 *
 * ── The rules it speaks under ──────────────────────────────────────────────
 *
 * Interruption is the whole risk here, so: nothing before 7am or after 11pm,
 * never while typing, never over an open voice conversation, one item at a
 * time, and nothing said twice in a day. Muting the app's sound silences it
 * completely — that is the off switch, and it is deliberately the same one
 * that silences everything else rather than a setting buried three levels
 * down.
 */

const POLL_MS = 240_000; // four minutes
const SEEN_KEY = "sage-ambient-seen";

interface Item { key: string; urgency: string; text: string; domain: string; href?: string }

function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (el as HTMLElement).isContentEditable;
}

export function AmbientVoice() {
  const armed = useRef(false);
  const voiceOpen = useRef(false);

  useEffect(() => {
    /**
     * Audio needs a gesture before a browser will play it. Until he has
     * touched the page once, speaking is not merely rude, it is impossible —
     * so the loop does not even poll.
     */
    const arm = () => { armed.current = true; };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { once: true, passive: true }));

    const onVoice = (e: Event) => {
      const state = (e as CustomEvent<{ state?: string }>).detail?.state;
      voiceOpen.current = state === "listening" || state === "thinking" || state === "speaking";
    };
    window.addEventListener("sage:voice-state", onVoice);

    const today = new Date().toISOString().slice(0, 10);
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
      if (isTyping() || document.hidden) return;

      /**
       * Never talk over something already being said.
       *
       * `voiceOpen` only covers the voice overlay, so this had no idea when an
       * unrelated part of the app was mid-sentence — and starting a new
       * utterance abandons the rest of the previous one. That is what cut the
       * morning brief off partway through: press Listen, and four minutes
       * later the ambient poll interrupted and the remaining parts were
       * silently dropped. Nothing here is urgent enough to interrupt for; it
       * waits for the next tick.
       */
      if (isSpeaking()) return;

      try {
        const res = await fetch("/api/ambient");
        const json = await res.json();
        if (!json?.ok) return;

        const items: Item[] = json.data.items ?? [];
        if (!items.length) return;

        const seen = readSeen();

        /**
         * The first poll of a session announces nothing.
         *
         * Everything standing when you open the app is a backlog, and reading
         * a backlog aloud is the behaviour that makes people close the tab.
         * It is recorded as seen instead, so only what appears *after* you
         * arrive gets said.
         */
        if (first) {
          items.forEach((i) => (seen[i.key] = "1"));
          writeSeen(seen);
          first = false;
          return;
        }

        const fresh = items.filter((i) => !seen[i.key]);
        if (!fresh.length) return;

        // Server-side ranking already put the most costly-to-miss first, and
        // held chatter back behind anything pressing.
        const say = fresh[0];
        seen[say.key] = "1";
        writeSeen(seen);

        hudHighlight("sitrep");
        await speakLowLatency(`Sir — ${say.text}`, { fast: true });
      } catch {
        /* offline, or the model is out of quota; try again next tick */
      }
    };

    const timer = window.setInterval(check, POLL_MS);
    const kick = window.setTimeout(check, 12_000);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(kick);
      events.forEach((e) => window.removeEventListener(e, arm));
      window.removeEventListener("sage:voice-state", onVoice);
    };
  }, []);

  return null;
}
