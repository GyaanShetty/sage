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

/*
 * A ceiling on speech, independent of dedupe.
 *
 * The dedupe key is computed on the server, and it only takes one key that
 * embeds a changing value — a price, a count — for an item to look new on
 * every poll and be announced forever. That is not hypothetical: the anomaly
 * key was built from its rendered text, which contains the live price, and
 * SAGE repeated the same sitrep every four minutes until it was killed.
 *
 * Fixing the key fixes that instance. These two limits mean the *class* of
 * bug can no longer produce a loop: at most one thing spoken every quarter of
 * an hour, and at most a dozen in a day. If SAGE ever has more than twelve
 * genuinely urgent things to say in one day, it should not be saying them
 * through an ambient poll.
 */
const MIN_GAP_MS = 900_000;   // fifteen minutes between anything spoken
const MAX_PER_DAY = 12;
const RATE_KEY = "sage-ambient-rate";

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
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify({ day: today, items }));
      } catch {
        /* storage full or blocked — the rate limit below still holds */
      }
    };

    /** How many have been spoken today, and when the last one was. */
    const readRate = (): { day: string; count: number; last: number } => {
      try {
        const raw = JSON.parse(localStorage.getItem(RATE_KEY) || "{}");
        return raw?.day === today ? raw : { day: today, count: 0, last: 0 };
      } catch {
        return { day: today, count: 0, last: 0 };
      }
    };
    const writeRate = (r: { day: string; count: number; last: number }) => {
      try { localStorage.setItem(RATE_KEY, JSON.stringify(r)); } catch { /* no-op */ }
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

      // The ceiling, checked before the request so a rate-limited session is
      // also a quiet one on the network.
      const rate = readRate();
      if (rate.count >= MAX_PER_DAY) return;
      if (rate.last && Date.now() - rate.last < MIN_GAP_MS) return;

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
        writeRate({ day: today, count: rate.count + 1, last: Date.now() });

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
