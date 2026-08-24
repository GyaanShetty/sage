"use client";

import { useEffect, useRef } from "react";

/**
 * Making the dashboard feel live.
 *
 * ── Why it felt dead ───────────────────────────────────────────────────────
 *
 * Every panel polled on its own timer — 20s here, 150s there, 900s on the
 * atlas — and each one only ever refreshed when its timer happened to fire.
 * Two consequences, both of which read as "this isn't live":
 *
 *  1. Coming back to the tab showed whatever was fetched before you left. A
 *     panel on a 15-minute timer could sit there for 15 minutes, and nothing
 *     about looking directly at it made it check.
 *
 *  2. Doing something in one panel did not update any other. Ticking off a
 *     task left the counts elsewhere on the page describing a world that no
 *     longer existed, until each of them independently timed out.
 *
 * A timer is the fallback, not the mechanism. What actually makes an interface
 * feel live is refreshing at the moments a human expects it to: when they look
 * at it, and when something changed.
 *
 * ── What this does not fix ─────────────────────────────────────────────────
 *
 * Panels backed by rate-limited third-party APIs are cached on the server on
 * purpose — Alpha Vantage's free tier is 25 requests a *day*. Refreshing more
 * eagerly there buys nothing but a spent quota, so those routes keep their
 * caches and this hook simply asks more often than it used to.
 *
 * ── Why not a push connection ──────────────────────────────────────────────
 *
 * The obvious answer to "make it instant" is server-sent events, and it is the
 * wrong one here. An SSE connection occupies a serverless function for as long
 * as it is held open, so a single tab left open all day is 24 hours of
 * function time per day — far past what a free plan includes, for an app whose
 * entire premise is that it costs nothing to run. Push would trade the thing
 * this project is for.
 *
 * What is affordable is spending the budget where someone is actually looking.
 * A hidden tab polling every 20 seconds is pure waste; the same requests moved
 * to the foreground make the app feel live and cost less in total, because a
 * hidden tab now costs nothing at all.
 */

/** Broadcast that something changed, so every live panel re-reads at once. */
export const DATA_CHANGED = "sage:data-changed";

export function notifyDataChanged(scope?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DATA_CHANGED, { detail: { scope } }));
}

export interface LiveOptions {
  /**
   * How often to poll **while the tab is visible**. A hidden tab does not
   * poll at all — see below — so this can be far more frequent than the old
   * always-on intervals were, for less traffic overall.
   */
  everyMs?: number;
  /**
   * Keep polling while hidden, at this interval. Almost nothing needs this:
   * a panel nobody is looking at can be refreshed the instant they look back.
   * Reach for it only when the fetch has a side effect that must keep
   * happening — delivering a due reminder, say.
   */
  hiddenMs?: number;
  /**
   * Which change notifications this panel cares about. Omitted → all of them.
   * A task panel has no reason to re-fetch because a journal entry was saved.
   */
  scopes?: string[];
  /** Skip the refresh-on-return behaviour (rarely wanted). */
  onFocus?: boolean;
}

/**
 * Run `load` now, on a timer, whenever the tab is looked at again, and
 * whenever anything announces a change.
 *
 * `load` is held in a ref, so a caller may pass an inline arrow without
 * re-arming the timer on every render — the bug that pattern usually causes.
 */
export function useLive(load: () => void | Promise<unknown>, opts: LiveOptions = {}): void {
  const { everyMs, hiddenMs, scopes, onFocus = true } = opts;
  const ref = useRef(load);
  ref.current = load;

  useEffect(() => {
    const run = () => void ref.current();

    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    /**
     * Arm the timer for the tab's current state.
     *
     * Visible: poll at `everyMs`. Hidden: stop entirely unless the caller
     * explicitly asked to keep going, because refreshing a panel nobody is
     * looking at buys nothing and is paid for in someone's free-tier quota.
     */
    const arm = () => {
      stop();
      const interval = document.hidden ? hiddenMs : everyMs;
      if (interval) timer = setInterval(run, interval);
    };

    run();
    arm();

    // Coming back is the moment the data is about to be read, so it refreshes
    // immediately rather than waiting out whatever is left of an interval.
    const onVisible = () => {
      if (!document.hidden) run();
      arm();
    };

    const onChanged = (e: Event) => {
      if (!scopes) return run();
      const scope = (e as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scopes.includes(scope)) run();
    };

    if (onFocus) {
      window.addEventListener("focus", onVisible);
    }
    // Always tracked, even with onFocus off: the pause-while-hidden behaviour
    // is about not wasting quota, not about the refresh-on-return convenience.
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(DATA_CHANGED, onChanged);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      if (onFocus) {
        window.removeEventListener("focus", onVisible);
      }
      window.removeEventListener(DATA_CHANGED, onChanged);
    };
    // scopes is spread so a caller may pass an inline array literal.
  }, [everyMs, hiddenMs, onFocus, ...(scopes ?? [])]);
}
