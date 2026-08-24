"use client";

import { useEffect, useRef } from "react";
import { useLive } from "@/lib/live";

/**
 * Deliver reminders on time while SAGE is open.
 *
 * The scheduler runs twice a day on the free plan, so a 3pm reminder was
 * arriving at 9pm. That is not a reminder. This closes the gap for the case
 * that matters most — the app is on a screen — by asking the server once a
 * minute whether anything has come due.
 *
 * It is a poll rather than a client-side timer on purpose. A timer would only
 * know about reminders created in this tab, would drift while the tab is
 * backgrounded, and would fire nothing at all after a refresh. The server
 * knows about every reminder from every device, and the claim-before-send in
 * fireDueReminders means several tabs polling cannot double-notify.
 */

const EVERY_MS = 60_000;

export function ReminderTicker() {
  const running = useRef(false);

  const tickRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      // A slow response must not stack up behind the next interval.
      if (running.current || document.visibilityState === "hidden") return;
      running.current = true;
      try {
        const j = await fetch("/api/reminders/tick", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null);
        if (cancelled) return;

        for (const r of j?.data?.fired ?? []) {
          // Web push may not be granted, and even when it is the banner can be
          // missed. Saying it in the app too costs nothing and means an open
          // SAGE never silently swallows a reminder.
          window.dispatchEvent(new CustomEvent("sage:toast", { detail: { title: "⏰ REMINDER", body: r.text } }));
        }
      } finally {
        running.current = false;
      }
    };

    tickRef.current = tick;
    return () => { cancelled = true; };
  }, []);

  /**
   * The one poll that keeps going while the tab is hidden.
   *
   * Everything else in SAGE pauses when nobody is looking, because refreshing
   * a panel nobody can see buys nothing. This is different: it does not just
   * *show* something, it fires due reminders — marking them, mirroring them to
   * a task, pushing them. A reminder that waits for you to look at the tab is
   * not a reminder.
   *
   * So it slows down rather than stopping: a minute in front of you, three
   * minutes behind. Coming back also triggers it immediately, which is exactly
   * when a missed reminder is most likely.
   */
  useLive(() => tickRef.current?.(), { everyMs: EVERY_MS, hiddenMs: 3 * EVERY_MS });

  return null;
}
