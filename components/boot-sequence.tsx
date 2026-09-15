"use client";

import { useEffect, useState } from "react";
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

/** Cinematic cold-boot: terminal init lines, mark ignition, dissolve. Once per session. */
export function BootSequence() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("sage-booted")) return;
      sessionStorage.setItem("sage-booted", "1");
    } catch {}
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShow(true);
  }, []);

  useEffect(() => {
    if (!show) return;
    if (step < LINES.length) {
      const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 260 : 190);
      return () => clearTimeout(t);
    }
    sound.chime(); // may be silent pre-gesture; the visual carries it
    const t = setTimeout(() => setShow(false), 700);
    return () => clearTimeout(t);
  }, [show, step]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="boot"
          exit={{ opacity: 0, filter: "blur(6px)" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          onClick={() => setShow(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* The wordmark assembles out of noise while the checks run — the
                boot screen is the one place a decrypt effect is literally
                what is happening. */}
            <AsciiMark className="boot-mark" />
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
          {/* This one is determinate — it counts real checks — so it gets the
              filled meter rather than the indeterminate sweep. */}
          <AsciiMeter value={step / LINES.length} width={28} className="boot-meter" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
