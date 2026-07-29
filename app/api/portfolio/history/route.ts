import { NextResponse } from "next/server";
import { listSnapshots, snapshotToday } from "@/core/portfolio/snapshots";
import { getPositions } from "@/core/portfolio/store";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const dynamic = "force-dynamic";

/** Normalised benchmark series (index = 100 at the window start). */
async function benchmark(symbol: string, days: number): Promise<{ day: string; value: number }[]> {
  const range = days <= 35 ? "1mo" : days <= 100 ? "3mo" : days <= 200 ? "6mo" : "1y";
  try {
    const res = await proxyFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`,
      { signal: AbortSignal.timeout(9000), headers: { "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const r = j.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const closes = r?.indicators?.quote?.[0]?.close ?? [];
    const pairs = ts
      .map((t, i) => ({ day: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
      .filter((p): p is { day: string; close: number } => typeof p.close === "number");
    if (!pairs.length) return [];
    const base = pairs[0].close;
    return pairs.map((p) => ({ day: p.day, value: (p.close / base) * 100 }));
  } catch {
    return [];
  }
}

/**
 * Portfolio equity curve. Records today's value on read (so simply opening the
 * page builds history), and optionally returns a normalised benchmark to
 * compare against.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = Math.min(730, Math.max(7, Number(url.searchParams.get("days")) || 90));
  const bench = url.searchParams.get("benchmark") ?? "";

  // opportunistically snapshot today so the curve fills in over time
  try {
    const { totals } = await getPositions(url.origin, req.headers.get("cookie") ?? "");
    await snapshotToday(totals);
  } catch { /* pricing unavailable — skip today's point */ }

  const snaps = await listSnapshots(days);
  const series = snaps.map((s) => ({ day: s.day, value: s.value, cost: s.cost, pnl: s.pnl }));

  // normalise the portfolio to 100 at the window start for benchmark overlay
  const base = series.find((s) => s.value > 0)?.value ?? 0;
  const normalised = base > 0 ? series.map((s) => ({ day: s.day, value: (s.value / base) * 100 })) : [];
  const benchSeries = bench ? await benchmark(bench, days) : [];

  const first = series[0]?.value ?? 0;
  const last = series[series.length - 1]?.value ?? 0;
  const periodPct = first > 0 ? ((last - first) / first) * 100 : null;
  const benchFirst = benchSeries[0]?.value ?? 0;
  const benchLast = benchSeries[benchSeries.length - 1]?.value ?? 0;
  const benchPct = benchFirst > 0 ? ((benchLast - benchFirst) / benchFirst) * 100 : null;

  return NextResponse.json({
    ok: true,
    data: {
      series,
      normalised,
      benchmark: benchSeries,
      benchmarkSymbol: bench || null,
      periodPct,
      benchPct,
      alpha: periodPct != null && benchPct != null ? periodPct - benchPct : null,
      points: series.length,
    },
  });
}
