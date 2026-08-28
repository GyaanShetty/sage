/**
 * Laying overlapping events out side by side.
 *
 * Every event used to be `left: 2px; right: 2px`, so two things at the same
 * time occupied the same rectangle and stacked into an unreadable pile — the
 * calendar looked broken because, for any busy day, it was.
 *
 * The algorithm is the standard one:
 *
 * 1. Sort by start, then by longest-first so a long event takes the leftmost
 *    column and the short ones stack to its right, which is what people
 *    expect to see.
 * 2. Walk the list accumulating a *cluster* — a run of events connected by
 *    overlap. Connected, not mutually overlapping: A can overlap B and B
 *    overlap C while A and C never touch, and all three still have to share
 *    the width or C would be drawn over A's neighbour.
 * 3. Within a cluster give each event the first column whose last event has
 *    already ended.
 * 4. Width is 1/columns of the cluster, so the day is divided only as finely
 *    as its busiest moment requires.
 *
 * Pure, and separate from the component, because the awkward cases — nesting,
 * an event spanning several others, transitive chains — are exactly where this
 * kind of code is wrong, and they are only cheap to check in a test.
 */

export interface Span {
  /** Minutes from midnight. */
  start: number;
  /** Minutes from midnight. Must be > start; callers clamp zero-length events. */
  end: number;
}

export interface Placed {
  /** Index into the input array, so callers keep their own event objects. */
  index: number;
  /** Fraction of the column, 0..1. */
  left: number;
  /** Fraction of the column, 0..1. */
  width: number;
}

export function layoutSpans(spans: Span[]): Placed[] {
  if (spans.length === 0) return [];

  const order = spans
    .map((s, index) => ({ ...s, index }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.index - b.index);

  const out: Placed[] = [];

  // One cluster at a time. `reach` is the furthest end seen so far in the
  // cluster: an event starting before it is connected to the cluster even if
  // it does not touch the event immediately before it.
  let cluster: typeof order = [];
  let reach = -Infinity;

  const flush = () => {
    if (!cluster.length) return;

    /** Last end time placed in each column. */
    const columnEnds: number[] = [];
    /** Column assigned to each member, parallel to `cluster`. */
    const columnOf: number[] = [];

    for (const ev of cluster) {
      let col = columnEnds.findIndex((end) => end <= ev.start);
      if (col === -1) { col = columnEnds.length; columnEnds.push(ev.end); }
      else columnEnds[col] = ev.end;
      columnOf.push(col);
    }

    const cols = columnEnds.length;
    cluster.forEach((ev, i) => {
      out.push({ index: ev.index, left: columnOf[i] / cols, width: 1 / cols });
    });

    cluster = [];
    reach = -Infinity;
  };

  for (const ev of order) {
    if (cluster.length && ev.start >= reach) flush();
    cluster.push(ev);
    reach = Math.max(reach, ev.end);
  }
  flush();

  // Back into input order, so callers can zip it against their own array.
  return out.sort((a, b) => a.index - b.index);
}
