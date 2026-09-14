/**
 * Is a navigation in flight?
 *
 * A route change is a React transition, and every state update that lands
 * while it renders throws that render away and starts it again. On a wall of
 * thirty tiles the answers to thirty fetches kept arriving for seconds after
 * the click, and the navigation was restarted by each one until it simply
 * never finished.
 *
 * The fallback in components/nav-guard.tsx guarantees the click lands. This is
 * the other half: while a navigation is pending, live panels stop *starting*
 * new work. It cannot recall the requests already in flight, but it stops the
 * wall adding to them, which is what lets the client-side navigation win and
 * keeps the fallback for the cases that really need it.
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
