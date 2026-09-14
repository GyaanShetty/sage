/**
 * Is a navigation in flight?
 *
 * A route change is a React transition, and every state update that lands
 * while it renders throws that render away and starts it again. On a wall of
 * thirty tiles the answers to thirty fetches kept arriving for seconds after
 * the click, and the navigation was restarted by each one until it simply
 * never finished.
 *
 * The fallback in components/nav-guard.tsx is what guarantees the click lands.
 * This is a smaller, unproven companion: while a navigation is pending, live
 * panels stop *starting* new work, so the wall adds no new interruptions to
 * the render the navigation is waiting on.
 *
 * Honest about its evidence: measured on a machine with no database, where
 * every API call takes four to seven seconds, it changed none of the fifteen
 * link timings — the fallback was already carrying them. It is kept because
 * the reasoning holds and the cost is one skipped poll on a page being left
 * behind, not because a test showed it working. If navigation still feels
 * slow on real latency, this is the first thing to re-measure rather than the
 * first thing to trust.
 *
 * A module-level flag rather than context on purpose: useLive is called from
 * seventy places and must be able to ask this question without re-rendering
 * anything, and a paused poll is not state anyone renders.
 */

let pending = 0;

/** Marks a navigation as started. Returns the function that ends it. */
export function navStarted(): () => void {
  pending += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending = Math.max(0, pending - 1);
  };
}

export function navPending(): boolean {
  return pending > 0;
}
