"use client";

/**
 * A live reading that knows when it last arrived, and does not throw away
 * what it had when a refresh fails.
 *
 * The pattern this replaces was `setX(j?.data ?? null)`, which looks harmless
 * and has three faults:
 *
 *   · A failed refresh blanks a good reading. The sky pane showed a full moon
 *     phase, sunrise and ISS altitude on one tab and an empty disc with
 *     dashes on another — same component, same endpoint, one unlucky fetch.
 *   · "No data" and "the request failed" render identically, so a broken
 *     feed is indistinguishable from an empty one.
 *   · Nothing records when the number arrived, so a LIVE badge stays lit over
 *     a figure that stopped updating an hour ago.
 *
 * So: keep the last good value, remember when it landed, and say plainly when
 * the most recent attempt failed. A stale number labelled stale is useful; a
 * stale number labelled LIVE is a lie, and a blank where a number was is a
 * bug report waiting to be written.
 */

import { useCallback, useRef, useState } from "react";
import { useLive } from "@/lib/live";

export interface Feed<T> {
  /** The last good value, or null if none has ever arrived. */
  data: T | null;
  /** When that value landed. */
  at: Date | null;
  /** True when the most recent attempt failed or returned nothing usable. */
  failed: boolean;
  /** True until the first attempt settles, so panes can wait rather than empty. */
  loading: boolean;
}

/**
 * `url` may be null to hold off fetching.
 *
 * Hooks cannot be called conditionally, so a panel that wants to defer an
 * expensive request until after first paint has no way to express it except
 * by passing null and swapping in the real URL when it is ready. The skies
 * panel does exactly that: its upstream is a 2.1MB download and it has no
 * business being one of the dozen calls the dashboard makes while drawing.
 */
export function useFeed<T>(
  url: string | null,
  opts: { everyMs?: number; hiddenMs?: number; scopes?: string[]; pick?: (json: unknown) => T | null } = {},
): Feed<T> {
  const { everyMs, hiddenMs, scopes, pick } = opts;
  const [state, setState] = useState<Feed<T>>({ data: null, at: null, failed: false, loading: true });

  // Held in a ref so changing the picker inline does not re-arm the timer.
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const run = useCallback(async () => {
    // Not armed yet. Stay in the loading state rather than reporting failure —
    // nothing has been asked for, so nothing has gone wrong.
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      const value = pickRef.current
        ? pickRef.current(json)
        : ((json as { data?: T })?.data ?? null);

      if (value === null || value === undefined) {
        // Nothing usable came back. Keep whatever we had and say so.
        setState((prev) => ({ ...prev, failed: true, loading: false }));
        return;
      }
      setState({ data: value, at: new Date(), failed: false, loading: false });
    } catch {
      setState((prev) => ({ ...prev, failed: true, loading: false }));
    }
  }, [url]);

  useLive(run, { everyMs, hiddenMs, scopes });
  return state;
}

/** "14:32", or "—" before anything has arrived. */
export function freshLabel(at: Date | null, tz = "Asia/Kolkata"): string {
  if (!at) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

/**
 * How old a reading is allowed to be before it stops counting as live.
 * Generous, because most of these refresh every ten to fifteen minutes.
 */
export function isStale(at: Date | null, maxAgeMs = 45 * 60_000): boolean {
  return !at || Date.now() - at.getTime() > maxAgeMs;
}
