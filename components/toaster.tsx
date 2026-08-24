"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { sound } from "@/lib/sound";
import { useLive } from "@/lib/live";

interface Toast {
  id: string;
  title: string;
  body?: string;
  kind?: "info" | "alert";
}

interface SystemEvent {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

function describe(ev: SystemEvent): { title: string; body?: string; kind: "info" | "alert" } | null {
  const p = ev.payload ?? {};
  switch (ev.type) {
    case "reminder.fired":
      return { title: "REMINDER", body: String(p.text ?? ""), kind: "alert" };
    case "memory.extracted":
      return { title: "MEMORY COMMITTED", body: String(p.content ?? p.summary ?? "New memory learned"), kind: "info" };
    case "automation.completed":
      return { title: "AUTOMATION COMPLETE", body: String(p.name ?? ""), kind: "info" };
    case "weekly.review":
      return { title: "WEEKLY REVIEW SENT", body: `Emailed to ${String(p.sentTo ?? "you")}`, kind: "info" };
    case "market.analysis":
      return { title: "MARKET BRIEF FILED", body: "The desk posted a fresh analysis", kind: "info" };
    case "health.report":
      return { title: "VITALS SYNCED", kind: "info" };
    default:
      return null;
  }
}

const SEEN_KEY = "sage-toast-seen";

/**
 * Live overlay layer: slide-in toasts for system activity (reminders,
 * memories, briefs). Fires real browser notifications for reminders when
 * permission is granted. Other components can push toasts via
 * `window.dispatchEvent(new CustomEvent("sage:toast", { detail: { title, body } }))`.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenRef = useRef<string>("");

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    sound.tick();
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 7000);
  }, []);

  // Manual pushes from anywhere in the app.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as Omit<Toast, "id"> | undefined;
      if (d?.title) push(d);
    };
    window.addEventListener("sage:toast", handler);
    return () => window.removeEventListener("sage:toast", handler);
  }, [push]);

  // Ask for notification permission on the first interaction (not on load).
  useEffect(() => {
    const ask = () => {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    };
    window.addEventListener("pointerdown", ask, { once: true });
    return () => window.removeEventListener("pointerdown", ask);
  }, []);

  // Poll system events; toast anything new since last seen.
  //
  // `first` lives in a ref rather than the effect, because the poll no longer
  // runs inside one: it has to survive being paused while the tab is hidden
  // and resumed when it comes back, without replaying the whole backlog as
  // fresh toasts.
  const firstRef = useRef(true);

  /**
   * Restore what has already been seen, before the first poll runs.
   *
   * Declared above useLive so this effect runs first. Without it seenRef stays
   * empty across a reload and the very first poll marks the whole backlog as
   * seen without showing any of it — so anything that arrived while the page
   * was closed would be silently swallowed. `first` suppresses the backlog
   * only on a genuinely first run, when there is no marker to compare against.
   */
  useEffect(() => {
    seenRef.current = localStorage.getItem(SEEN_KEY) ?? "";
    firstRef.current = !seenRef.current;
  }, []);

  const poll = useCallback(async () => {
      try {
        const res = await fetch("/api/events/recent");
        const json = await res.json();
        const events = (json.data ?? []) as SystemEvent[];
        if (!events.length) return;
        const newest = events[0].createdAt;
        if (!firstRef.current) {
          const fresh = events.filter((e) => e.createdAt > seenRef.current).reverse();
          for (const ev of fresh.slice(-3)) {
            const d = describe(ev);
            if (!d) continue;
            push(d);
            if (d.kind === "alert" && "Notification" in window && Notification.permission === "granted") {
              new Notification(`SAGE · ${d.title}`, { body: d.body, icon: "/icon-192.png" });
            }
          }
        }
        firstRef.current = false;
        seenRef.current = newest;
        localStorage.setItem(SEEN_KEY, newest);
      } catch {}
  }, [push]);

  /**
   * Paused while the tab is hidden.
   *
   * Safe because this only *shows* things — a toast nobody can see is worth
   * nothing, and push notifications are delivered by the server, not by this
   * poll. Whatever arrived while you were away is toasted on your return.
   */
  useLive(poll, { everyMs: 45_000 });

  return (
    <div className="toaster">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 60, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: 60, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className={`toast${t.kind === "alert" ? " alert" : ""}`}
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            <span className="toast-rail" />
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-text">{t.body}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
