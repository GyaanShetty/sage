"use client";

import { useEffect, useRef, useState } from "react";
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
/** How often to ask once a reminder is nearly due. */
const CLOSE_MS = 10_000;
/** How near "nearly due" is. */
const CLOSE_WINDOW_MS = 3 * 60_000;

export function ReminderTicker() {
  const running = useRef(false);

  const tickRef = useRef<(() => void) | null>(null);
  /** True when the next pending reminder is close enough to poll harder for. */
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      /**
       * A slow response must not stack up behind the next interval.
       *
       * Note what is NOT checked here any more: visibility. This used to
       * return early whenever the tab was hidden, which quietly cancelled the
       * one poll in the app that is explicitly supposed to keep running when
       * nobody is looking — the comment below promised "a minute in front of
       * you, three minutes behind" while the guard delivered nothing behind.
       * Firing is a server-side effect; useLive already slows the interval
       * down when hidden, which is the throttling that was actually wanted.
       */
      if (running.current) return;
      running.current = true;
      try {
        const j = await fetch("/api/reminders/tick", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null);
        if (cancelled) return;

        /**
         * How close the next one is decides how often to ask again.
         *
         * A flat one-minute poll means a reminder set for 15:00 lands at
         * 15:00:59 — "in fifteen minutes" arriving sixteen minutes later. So
         * once something is due within three minutes this closes to ten
         * seconds, and goes back to a minute afterwards. The cost is a handful
         * of extra requests around the moment they matter, and nothing at all
         * the rest of the day.
         */
        const nextAt = j?.data?.next?.remindAt ? new Date(j.data.next.remindAt).getTime() : null;
        setClosing(nextAt !== null && nextAt - Date.now() < CLOSE_WINDOW_MS);

        for (const r of j?.data?.fired ?? []) {
          // Web push may not be granted, and even when it is the banner can be
          // missed. Saying it in the app too costs nothing and means an open
          // SAGE never silently swallows a reminder.
          // Say how late it was when it was late. lateMin was already
          // computed and thrown away, which meant a reminder delivered six
          // hours after its time looked exactly like one delivered on time.
          const late = Number(r.lateMin) >= 2 ? ` · ${Number(r.lateMin) >= 120 ? `${Math.round(Number(r.lateMin) / 60)}h` : `${Math.round(Number(r.lateMin))}m`} late` : "";
          window.dispatchEvent(new CustomEvent("sage:toast", { detail: { title: `⏰ REMINDER${late}`, body: r.text } }));
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
  useLive(() => tickRef.current?.(), {
    everyMs: closing ? CLOSE_MS : EVERY_MS,
    hiddenMs: closing ? EVERY_MS : 3 * EVERY_MS,
  });

  return null;
}
