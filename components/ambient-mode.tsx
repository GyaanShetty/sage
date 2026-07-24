"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useShellStore } from "@/features/shell/store";
import { APP_NAME } from "@/lib/config";

const IDLE_MS = 90_000; // 90s of no interaction → ambient mode
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

interface Alert {
  level: "info" | "warn" | "high";
  icon: string;
  text: string;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function greeting(h: number): string {
  if (h < 12) return "Good morning, sir";
  if (h < 17) return "Good afternoon, sir";
  if (h < 21) return "Good evening, sir";
  return "Good evening, sir";
}

/**
 * Idle "mission-control screensaver". After 90s of no interaction a cinematic
 * full-screen overlay fades in — oversized IST clock, date, greeting and a
 * slow carousel of live SITREP alerts. Any interaction dismisses it instantly.
 * Opt-out persisted in the shell store (ambientArmed). Skipped when a voice
 * session or the command palette is open, and under reduced-motion.
 */
export function AmbientMode() {
  const armed = useShellStore((s) => s.ambientArmed);
  const paletteOpen = useShellStore((s) => s.paletteOpen);
  const [active, setActive] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [idx, setIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceOpenRef = useRef(false);
  const now = useClock();

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const istHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now),
  );

  const arm = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!armed) return;
    timerRef.current = setTimeout(() => {
      if (voiceOpenRef.current || useShellStore.getState().paletteOpen) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      setActive(true);
    }, IDLE_MS);
  }, [armed]);

  // Interaction dismisses + re-arms the idle timer.
  useEffect(() => {
    const onActivity = () => {
      setActive((a) => {
        if (a) return false;
        return a;
      });
      arm();
    };
    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    arm();
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [arm]);

  useEffect(() => {
    const onState = (e: Event) => {
      voiceOpenRef.current = (e as CustomEvent).detail !== "off";
    };
    const onNow = () => setActive(true);
    window.addEventListener("sage:voice-state", onState);
    window.addEventListener("sage:ambient-now", onNow);
    return () => {
      window.removeEventListener("sage:voice-state", onState);
      window.removeEventListener("sage:ambient-now", onNow);
    };
  }, []);

  // Load SITREP alerts when the overlay opens; rotate through them.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/api/sitrep")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setAlerts((j?.data?.alerts ?? j?.data ?? []) as Alert[]);
      })
      .catch(() => {});
    const rot = setInterval(() => setIdx((i) => i + 1), 6000);
    return () => {
      cancelled = true;
      clearInterval(rot);
    };
  }, [active]);

  if (paletteOpen) return null;
  const current = alerts.length ? alerts[idx % alerts.length] : null;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-black/92 backdrop-blur-3xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
        >
          {/* faint drifting aurora */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-1/2 opacity-40"
            style={{
              background:
                "radial-gradient(closest-side, rgba(94,207,214,0.10), transparent 70%), radial-gradient(closest-side, rgba(120,140,255,0.08), transparent 70%)",
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 120, repeat: Infinity, ease: "linear" }}
          />

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 0.7, y: 0 }}
            transition={{ delay: 0.3 }}
            className="lbl !text-[10px] !tracking-[4px] text-[var(--live)]"
          >
            {APP_NAME} · STANDBY
          </motion.p>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 1 }}
            className="mt-4 select-none font-mono text-[19vw] font-thin leading-none tracking-tighter text-foreground tabular-nums md:text-[13vw]"
          >
            {time}
          </motion.div>

          <p className="mt-2 text-lg font-light tracking-wide text-muted md:text-2xl">{date}</p>
          <p className="mt-6 text-base tracking-[2px] text-subtle md:text-lg">{greeting(istHour)}</p>

          <div className="mt-12 h-8 px-6 text-center">
            <AnimatePresence mode="wait">
              {current && (
                <motion.p
                  key={idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.5 }}
                  className={
                    "flex items-center gap-2 text-sm md:text-base " +
                    (current.level === "high"
                      ? "text-red-300"
                      : current.level === "warn"
                        ? "text-amber-300"
                        : "text-muted")
                  }
                >
                  <span aria-hidden>{current.icon}</span>
                  {current.text}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            transition={{ delay: 1.2 }}
            className="lbl absolute bottom-8 !text-[9px] !tracking-[3px] text-subtle"
          >
            MOVE TO RESUME
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
