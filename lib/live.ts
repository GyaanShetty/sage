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
 */

/** Broadcast that something changed, so every live panel re-reads at once. */
export const DATA_CHANGED = "sage:data-changed";

export function notifyDataChanged(scope?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DATA_CHANGED, { detail: { scope } }));
}

export interface LiveOptions {
  /** Fallback timer, for things that change without anyone doing anything. */
  everyMs?: number;
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
  const { everyMs, scopes, onFocus = true } = opts;
  const ref = useRef(load);
  ref.current = load;

  useEffect(() => {
    const run = () => void ref.current();
    run();

    const timer = everyMs ? setInterval(run, everyMs) : null;

    // Only when actually visible: a background tab firing fetches is the
    // thing this is meant to avoid, not cause.
    const onVisible = () => { if (!document.hidden) run(); };

    const onChanged = (e: Event) => {
      if (!scopes) return run();
      const scope = (e as CustomEvent<{ scope?: string }>).detail?.scope;
      if (!scope || scopes.includes(scope)) run();
    };

    if (onFocus) {
      window.addEventListener("focus", onVisible);
      document.addEventListener("visibilitychange", onVisible);
    }
    window.addEventListener(DATA_CHANGED, onChanged);

    return () => {
      if (timer) clearInterval(timer);
      if (onFocus) {
        window.removeEventListener("focus", onVisible);
        document.removeEventListener("visibilitychange", onVisible);
      }
      window.removeEventListener(DATA_CHANGED, onChanged);
    };
    // scopes is spread so a caller may pass an inline array literal.
  }, [everyMs, onFocus, ...(scopes ?? [])]);
}
