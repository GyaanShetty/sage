/**
 * SAGE's heartbeat, running on Cloudflare.
 *
 * Vercel's free plan allows two cron invocations a day. Cloudflare Workers
 * allow a cron trigger every minute, free, and a Worker that does nothing but
 * make one fetch costs nothing measurable. So the schedule lives here and the
 * decisions live in SAGE: this knocks once a minute, /api/beat works out what
 * is actually due.
 *
 * Deliberately dumb. It holds no schedule, no retry logic beyond one immediate
 * retry, and no knowledge of what SAGE does — anything smarter would be a
 * second place to change when the schedule changes.
 *
 * ── Setup ──────────────────────────────────────────────────────────────────
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker. Paste this.
 *   2. Settings → Variables:
 *        SAGE_URL    = https://your-app.vercel.app
 *        CRON_SECRET = (the same value as in Vercel)
 *      Add CRON_SECRET as an *encrypted* secret, not a plain variable.
 *   3. Settings → Triggers → Cron Triggers → Add: `* * * * *`
 *   4. Visit the worker URL once to confirm it reports ok.
 *
 * Nothing else changes. If the Worker stops, SAGE falls back to its two daily
 * Vercel crons on its own — later, but not broken.
 */

async function knock(env) {
  const base = (env.SAGE_URL || "").replace(/\/+$/, "");
  if (!base) return { ok: false, error: "SAGE_URL is not set" };

  const request = () =>
    fetch(`${base}/api/beat`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${env.CRON_SECRET || ""}`,
        "user-agent": "SAGE-heartbeat/1",
      },
      // A beat that has not answered in 50s will not answer: the next minute's
      // beat picks up the same work, because cadence is tracked server-side.
      signal: AbortSignal.timeout(50_000),
    });

  try {
    let res = await request();
    // One retry, for a cold serverless instance that timed out starting up.
    if (!res.ok && res.status >= 500) res = await request();
    return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 500) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(knock(env));
  },

  /** Visiting the worker runs one beat by hand — useful for checking setup. */
  async fetch(_request, env) {
    const result = await knock(env);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { "content-type": "application/json" },
    });
  },
};
