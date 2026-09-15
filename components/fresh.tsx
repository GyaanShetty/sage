"use client";

/**
 * A pane's freshness, in the corner where LIVE used to sit.
 *
 * LIVE was a static word. It said the same thing over a number that arrived
 * four seconds ago and one that stopped updating at breakfast, which makes it
 * decoration rather than a reading.
 *
 * Three states, and the distinction between the last two is the one that
 * matters: nothing has ever arrived, versus something arrived and the refresh
 * since has failed. The first is usually a connector you have not set up; the
 * second is a thing that is broken. A dashboard that renders them identically
 * sends you looking in the wrong place.
 */

import { freshLabel, isStale, type Feed } from "@/lib/feed";

export function Fresh<T>({ feed, maxAgeMs }: { feed: Feed<T>; maxAgeMs?: number }) {
  if (feed.loading && !feed.data) return <span className="fresh">…</span>;

  if (!feed.data) {
    return <span className="fresh bad" title="The request failed — this is not an empty state">NO SIGNAL</span>;
  }

  const stale = isStale(feed.at, maxAgeMs);
  return (
    <span
      className={`fresh${feed.failed ? " warn" : stale ? " warn" : ""}`}
      title={feed.failed ? "Showing the last good reading; the latest refresh failed" : "Last updated"}
    >
      {feed.failed ? "STALE " : ""}{freshLabel(feed.at)}
    </span>
  );
}
