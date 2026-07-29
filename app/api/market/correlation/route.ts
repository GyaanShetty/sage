import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const cache = new Map<string, { at: number; closes: Record<string, number> }>();
const TTL = 30 * 60 * 1000;

/** Daily closes keyed by day, for one symbol. */
async function closesFor(symbol: string, range: string): Promise<Record<string, number>> {
  const key = `${symbol}:${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.closes;
  try {
    const res = await proxyFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`,
      { signal: AbortSignal.timeout(9000), headers: { "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return {};
    const j = (await res.json()) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const r = j.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const cl = r?.indicators?.quote?.[0]?.close ?? [];
    const out: Record<string, number> = {};
    ts.forEach((t, i) => {
      const v = cl[i];
      if (typeof v === "number") out[new Date(t * 1000).toISOString().slice(0, 10)] = v;
    });
    cache.set(key, { at: Date.now(), closes: out });
    return out;
  } catch {
    return {};
  }
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, dbv = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; dbv += y * y;
  }
  const den = Math.sqrt(da * dbv);
  return den === 0 ? 0 : num / den;
}

/**
 * Correlation matrix across a set of symbols, computed on daily returns.
 * Shows which of your holdings actually move together — i.e. where you think
 * you're diversified but aren't.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const range = url.searchParams.get("range") ?? "6mo";
  if (symbols.length < 2) {
    return NextResponse.json({ ok: false, error: "at least 2 symbols required" }, { status: 400 });
  }

  const all = await Promise.all(symbols.map((s) => closesFor(s, range)));

  // align on the days every symbol has a close for
  const daySets = all.map((c) => new Set(Object.keys(c)));
  const commonDays = [...(daySets[0] ?? [])].filter((d) => daySets.every((s) => s.has(d))).sort();

  const returns: Record<string, number[]> = {};
  symbols.forEach((sym, i) => {
    const closes = commonDays.map((d) => all[i][d]);
    const r: number[] = [];
    for (let k = 1; k < closes.length; k++) if (closes[k - 1] > 0) r.push((closes[k] - closes[k - 1]) / closes[k - 1]);
    returns[sym] = r;
  });

  const matrix = symbols.map((rowSym) =>
    symbols.map((colSym) => (rowSym === colSym ? 1 : Number(pearson(returns[rowSym], returns[colSym]).toFixed(3)))),
  );

  // flag the pairs that are effectively the same bet
  const pairs: { a: string; b: string; r: number }[] = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let k = i + 1; k < symbols.length; k++) pairs.push({ a: symbols[i], b: symbols[k], r: matrix[i][k] });
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  return NextResponse.json({
    ok: true,
    data: { symbols, matrix, days: commonDays.length, mostCorrelated: pairs.slice(0, 3), leastCorrelated: [...pairs].reverse().slice(0, 3) },
  });
}
