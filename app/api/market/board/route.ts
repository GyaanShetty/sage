import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * The wider board: volatility, commodities, rates and overnight futures.
 *
 * The markets page could tell you where your six names closed and nothing
 * about the weather they closed in. These are the readings that explain the
 * rest of the screen — VIX says how frightened the market is, crude and gold
 * say what is happening to input costs and to fear, the ten-year says what
 * money costs, and the US futures say what tomorrow morning in India has
 * already decided.
 *
 * All from Yahoo's keyless chart endpoint, which is the one that still
 * answers: v7/quote and v10/quoteSummary both return 401 to an unauthenticated
 * caller now, and they are the ones carrying P/E and market cap. So this route
 * promises only what the chart meta actually contains — price, day move,
 * 52-week range, day range, volume — and does not pretend to fundamentals it
 * cannot reach. See /api/market/profile for that.
 */

export interface Reading {
  symbol: string;
  label: string;
  price: number;
  changePct: number;
  currency: string;
  /** Where the price sits in its 52-week range, 0–1. Null when unknown. */
  band: number | null;
  low52: number | null;
  high52: number | null;
}

interface Group { key: string; label: string; rows: Reading[] }

/* Grouped so the panel can render sections without a second source of truth
   for what belongs where. Labels are ours: Yahoo's shortName for ^INDIAVIX is
   "INDIA VIX", but for GC=F it is "Gold Dec 26", which dates itself. */
const BOARD: { key: string; label: string; items: [string, string][] }[] = [
  { key: "vol", label: "Volatility", items: [
    ["^INDIAVIX", "India VIX"],
    ["^VIX", "CBOE VIX"],
  ]},
  { key: "futures", label: "US futures", items: [
    ["ES=F", "S&P 500"],
    ["NQ=F", "Nasdaq 100"],
    ["YM=F", "Dow"],
  ]},
  { key: "commodities", label: "Commodities", items: [
    ["CL=F", "Crude (WTI)"],
    ["BZ=F", "Brent"],
    ["GC=F", "Gold"],
    ["SI=F", "Silver"],
    ["HG=F", "Copper"],
    ["NG=F", "Nat gas"],
  ]},
  { key: "rates", label: "Rates", items: [
    ["^TNX", "US 10-year"],
    ["^FVX", "US 5-year"],
    ["^TYX", "US 30-year"],
  ]},
];

const cache = new Map<string, { at: number; r: Reading | null }>();
const TTL = 5 * 60_000;

async function read(symbol: string, label: string): Promise<Reading | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return hit.r;
  try {
    const res = await proxyFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { chart?: { result?: { meta?: Record<string, number | string> }[] } };
    const m = j.chart?.result?.[0]?.meta;
    const price = m?.regularMarketPrice as number | undefined;
    if (typeof price !== "number") throw new Error("no price");

    const low = m?.fiftyTwoWeekLow as number | undefined;
    const high = m?.fiftyTwoWeekHigh as number | undefined;
    // Where in its own year the thing is sitting. This is the reading that
    // makes a price mean something without a chart beside it.
    const band = typeof low === "number" && typeof high === "number" && high > low
      ? Math.min(1, Math.max(0, (price - low) / (high - low)))
      : null;

    const r: Reading = {
      symbol,
      label,
      price,
      changePct: (m?.regularMarketChangePercent as number) ?? 0,
      currency: (m?.currency as string) ?? "",
      band,
      low52: low ?? null,
      high52: high ?? null,
    };
    cache.set(symbol, { at: Date.now(), r });
    return r;
  } catch {
    // Keep a stale reading over nothing, and retry sooner than the full window.
    cache.set(symbol, { at: Date.now() - TTL + 60_000, r: hit?.r ?? null });
    return hit?.r ?? null;
  }
}

export async function GET() {
  const groups: Group[] = await Promise.all(
    BOARD.map(async (g) => ({
      key: g.key,
      label: g.label,
      rows: (await Promise.all(g.items.map(([s, l]) => read(s, l)))).filter((r): r is Reading => r !== null),
    })),
  );
  const live = groups.reduce((n, g) => n + g.rows.length, 0);
  return NextResponse.json({ ok: true, data: { groups: groups.filter((g) => g.rows.length), live } });
}
