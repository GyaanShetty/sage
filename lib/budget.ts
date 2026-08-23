/**
 * Time budgets for work that talks to the outside world.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Every step in the cron tick was already wrapped in `.catch()`, which looks
 * like it makes the step safe. It does not. `.catch()` handles a promise that
 * *rejects*; it does nothing at all for a promise that never settles. A single
 * upstream host that accepts the connection and then goes quiet will sit there
 * until the platform kills the whole function — taking with it every job that
 * had not run yet, silently, with no record of how far the tick got.
 *
 * That is exactly what production was doing: `/api/cron` and
 * `/api/reminders/tick` hitting the runtime timeout, and the jobs late in the
 * chain (pruning, the life report, the day close) never running on those ticks
 * without ever reporting a failure.
 *
 * So: nothing here waits forever, and the tick decides its own outcome rather
 * than letting the platform decide it.
 */

/** Run `p`, but give up after `ms` and use `fallback` instead. */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => {
    // Without this the process holds a live timer for the full `ms` even when
    // the work finished in a millisecond — which keeps a serverless function
    // billable and awake after it had nothing left to do.
    if (timer) clearTimeout(timer);
  });
}

/**
 * A shared stopwatch for a multi-step job.
 *
 * `step` gives each piece of work its own ceiling *and* refuses to start one
 * at all once the overall budget is spent, so a tick degrades into "ran the
 * first nine jobs, skipped the rest" instead of being killed mid-flight.
 */
export function deadline(totalMs: number) {
  const start = Date.now();
  const spent = () => Date.now() - start;
  const left = () => totalMs - spent();
  return {
    spent,
    left,
    expired: () => left() <= 0,
    /** Names of steps that never got to run, for the response body. */
    skipped: [] as string[],
    async step<T>(name: string, run: () => Promise<T>, stepMs: number, fallback: T): Promise<T> {
      const remaining = left();
      if (remaining <= 0) {
        this.skipped.push(name);
        return fallback;
      }
      return within(run(), Math.min(stepMs, remaining), fallback);
    },
  };
}
