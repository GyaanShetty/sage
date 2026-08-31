import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { asArray } from "@/lib/as-array";

export const revalidate = 1800;

/** Crypto Fear & Greed index — alternative.me, free and keyless. */
export async function GET() {
  try {
    const res = await proxyFetch("https://api.alternative.me/fng/?limit=8", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as {
      data?: { value: string; value_classification: string; timestamp: string }[];
    };
    const rows = asArray<{ value: string; value_classification: string; timestamp: string }>(j.data).map((d) => ({
      value: Number(d.value),
      label: d.value_classification,
      at: new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10),
    }));
    if (!rows.length) throw new Error("empty");

    const now = rows[0];
    const weekAgo = rows[rows.length - 1];
    return NextResponse.json({
      ok: true,
      data: {
        value: now.value,
        label: now.label,
        history: [...rows].reverse(),
        delta: now.value - weekAgo.value,
        // where this sits on the 0-100 dial, for the gauge arc
        angle: (now.value / 100) * 180 - 90,
      },
    });
  } catch {
    return NextResponse.json({ ok: true, data: null });
  }
}
