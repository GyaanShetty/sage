import { NextResponse } from "next/server";
import { countSkies, type SkyCounts, type State } from "@/core/skies";

/**
 * Live air traffic, from OpenSky's open state vectors.
 *
 * Anonymous callers share a small budget, and on Vercel the egress IP is
 * shared with everyone else on the platform — so the anonymous quota is
 * usually already spent by the time this asks, and the panel reads NO
 * CONTACT on production while working perfectly from a laptop. Setting
 * OPENSKY_USER and OPENSKY_PASS (a free account) moves this onto its own
 * much larger allowance and is the actual fix.
 *
 * Until then the route is at least honest about which failure it hit: a 429
 * is a quota, a 503 is OpenSky being down, a throw is the network. "No
 * contact" for all three tells you nothing you can act on.
 */

export const revalidate = 600;

/** Last good reading, so one refused refresh does not blank a live panel. */
let lastGood: { data: SkyCounts; at: number } | null = null;

function why(status: number): string {
  if (status === 429) return "rate limited — set OPENSKY_USER / OPENSKY_PASS";
  if (status === 401 || status === 403) return "credentials rejected";
  if (status >= 500) return "OpenSky unavailable";
  return `refused (${status})`;
}

export async function GET() {
  const user = process.env.OPENSKY_USER;
  const pass = process.env.OPENSKY_PASS;
  const headers: Record<string, string> = { accept: "application/json" };
  if (user && pass) {
    headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }

  try {
    const r = await fetch("https://opensky-network.org/api/states/all", {
      // An authenticated call has its own allowance, so it may be fresher.
      next: { revalidate: user ? 300 : revalidate },
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!r.ok) {
      return NextResponse.json({
        ok: !!lastGood,
        error: why(r.status),
        authed: !!user,
        ...(lastGood ? { data: { ...lastGood.data, at: lastGood.at }, stale: true } : {}),
      });
    }

    const j = (await r.json()) as { time?: number; states?: State[] };
    const states = Array.isArray(j.states) ? j.states : [];
    // An empty state list is a bad response, not an empty sky.
    if (states.length === 0) {
      return NextResponse.json({
        ok: !!lastGood, error: "empty response", authed: !!user,
        ...(lastGood ? { data: { ...lastGood.data, at: lastGood.at }, stale: true } : {}),
      });
    }

    const counts = countSkies(states);
    const at = (j.time ?? Math.floor(Date.now() / 1000)) * 1000;
    lastGood = { data: counts, at };

    return NextResponse.json({ ok: true, authed: !!user, data: { ...counts, at } });
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message.slice(0, 60);
    return NextResponse.json({
      ok: !!lastGood, error: msg, authed: !!user,
      ...(lastGood ? { data: { ...lastGood.data, at: lastGood.at }, stale: true } : {}),
    });
  }
}
