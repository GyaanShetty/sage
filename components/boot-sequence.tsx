"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AsciiMark } from "@/components/ascii/mark";
import { AsciiMeter } from "@/components/ascii/motifs";
import { sound } from "@/lib/sound";

const LINES = [
  "SAGE OS v0.2 — MISSION CONTROL",
  "MEMORY CORE ............ ONLINE",
  "KNOWLEDGE INDEX ........ ONLINE",
  "MARKET FEEDS ........... LIVE",
  "VOICE LINK ............. STANDBY",
  "ALL SYSTEMS NOMINAL",
];

/** How long the finished wordmark holds before the dashboard comes up. */
const HOLD_MS = 620;

/**
 * Cinematic cold-boot: terminal init lines, mark ignition, dissolve to the
 * dashboard. Once per session.
 *
 * The screen ends when the wordmark has finished assembling AND the checks
 * have all printed — whichever lands last. It used to end on a timer that
 * knew nothing about either, so the mark was cut off mid-decrypt on a slow
 * frame and idled on a fast one. The animation finishing is the event.
 */
export function BootSequence() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [markDone, setMarkDone] = useState(false);

  const onSettled = useCallback(() => setMarkDone(true), []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("sage-booted")) return;
      sessionStorage.setItem("sage-booted", "1");
    } catch {}
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShow(true);
  }, []);

  // The check lines, printing one after another.
  useEffect(() => {
    if (!show || step >= LINES.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 260 : 190);
    return () => clearTimeout(t);
  }, [show, step]);

  // The exit, gated on both halves being finished.
  useEffect(() => {
    if (!show || !markDone || step < LINES.length) return;
    sound.chime(); // may be silent pre-gesture; the visual carries it
    const t = setTimeout(() => setShow(false), HOLD_MS);
    return () => clearTimeout(t);
  }, [show, markDone, step]);

  const linesDone = step >= LINES.length;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="boot"
          exit={{ opacity: 0, filter: "blur(6px)", scale: 1.04 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          // Clicking skips, for the tenth cold start of the day.
          onClick={() => setShow(false)}
          role="button"
          tabIndex={0}
          aria-label="Skip the start-up sequence"
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") setShow(false); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* The wordmark assembles out of noise while the checks run — the
                boot screen is the one place a decrypt effect is literally
                what is happening. */}
            <AsciiMark className={`boot-mark${markDone ? " is-set" : ""}`} onSettled={onSettled} />
          </motion.div>
          <div className="boot-lines">
            {LINES.slice(0, step).map((l, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: i === step - 1 ? 1 : 0.45, y: 0 }}
                className={`boot-line${i === LINES.length - 1 ? " ok" : ""}`}
              >
                {l}
              </motion.div>
            ))}
          </div>
          {/* Determinate — it counts real checks — so it gets the filled
              meter rather than the indeterminate sweep. */}
          <AsciiMeter
            value={(step / LINES.length + (markDone ? 1 : 0)) / 2}
            width={28}
            className="boot-meter"
          />
          <div className={`boot-go${linesDone && markDone ? " on" : ""}`}>
            {linesDone && markDone ? "OPENING MISSION CONTROL" : "STAND BY"}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
