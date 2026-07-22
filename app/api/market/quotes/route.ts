import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  currency: string;
  spark: number[];
}

// Yahoo Finance chart API: free, no key, covers NSE (.NS), BSE (.BO),
// US tickers, and indices (^NSEI, ^BSESN). Cached 5 min per symbol.
const cache = new Map<string, { at: number; q: Quote | null }>();
const TTL = 5 * 60 * 1000;

async function fetchQuote(symbol: string): Promise<Quote | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return hit.q;
  try {
    const res = await proxyFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=15m&range=1d&includePrePost=false`,
      { signal: AbortSignal.timeout(9000), headers: { "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as {
      chart?: {
        result?: {
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            currency?: string;
            shortName?: string;
            symbol?: string;
          };
          indicators?: { quote?: { close?: (number | null)[] }[] };
        }[];
      };
    };
    const r = j.chart?.result?.[0];
    const price = r?.meta?.regularMarketPrice;
    const prev = r?.meta?.chartPreviousClose ?? r?.meta?.previousClose;
    if (typeof price !== "number" || typeof prev !== "number") throw new Error("no data");
    const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter((v): v is number => typeof v === "number");
    const q: Quote = {
      symbol: r?.meta?.symbol ?? symbol,
      name: r?.meta?.shortName ?? symbol,
      price,
      change: price - prev,
      changePct: prev ? ((price - prev) / prev) * 100 : 0,
      currency: r?.meta?.currency ?? "",
      spark: closes.filter((_, i) => i % Math.max(1, Math.floor(closes.length / 28)) === 0).slice(-28),
    };
    cache.set(symbol, { at: Date.now(), q });
    return q;
  } catch {
    cache.set(symbol, { at: Date.now() - TTL + 60_000, q: hit?.q ?? null });
    return hit?.q ?? null;
  }
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 16);
  if (!symbols.length) return NextResponse.json({ ok: false, error: "symbols required" }, { status: 400 });
  const quotes = (await Promise.all(symbols.map(fetchQuote))).filter((q): q is Quote => q !== null);
  return NextResponse.json({ ok: true, data: quotes });
}
