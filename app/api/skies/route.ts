import { NextResponse } from "next/server";
import { countSkies, type State } from "@/core/skies";

/**
 * Live air traffic, from OpenSky's open state vectors.
 *
 * The reference dashboard shows a flights counter, and I had written that
 * off as unbuildable. It is not: OpenSky publishes every tracked aircraft
 * anonymously, no key, and the payload really does carry ten thousand of
 * them. This turns it into the four numbers worth showing.
 *
 * Cached for ten minutes. Anonymous callers get a small daily budget and the
 * feed only updates every few seconds anyway, so polling it harder would
 * spend the allowance to show the same figure.
 */

export const revalidate = 600;

export async function GET() {
  try {
    const r = await fetch("https://opensky-network.org/api/states/all", {
      next: { revalidate },
      headers: { accept: "application/json" },
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: `sky ${r.status}` }, { status: 200 });

    const j = (await r.json()) as { time?: number; states?: State[] };
    const states = Array.isArray(j.states) ? j.states : [];

    return NextResponse.json({
      ok: true,
      data: { ...countSkies(states), at: (j.time ?? 0) * 1000 },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 80) }, { status: 200 });
  }
}
