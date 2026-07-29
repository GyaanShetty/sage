import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Candle { day: string; close: number }

async function series(symbol: string, range: string): Promise<Candle[]> {
  const res = await proxyFetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`,
    { signal: AbortSignal.timeout(9000), headers: { "user-agent": "Mozilla/5.0" } },
  );
  if (!res.ok) throw new Error(`quote ${res.status}`);
  const j = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const r = j.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  return ts
    .map((t, i) => ({ day: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter((c): c is Candle => typeof c.close === "number");
}

/**
 * "What if I'd bought X of SYMBOL N months ago?" — prices the hypothetical
 * against real history and returns the growth curve plus the headline numbers.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim();
  const amount = Number(url.searchParams.get("amount")) || 0;
  const range = url.searchParams.get("range") ?? "1y";
  if (!symbol || amount <= 0) {
    return NextResponse.json({ ok: false, error: "symbol and amount required" }, { status: 400 });
  }

  let candles: Candle[];
  try {
    candles = await series(symbol, ["1mo", "3mo", "6mo", "1y", "2y", "5y"].includes(range) ? range : "1y");
  } catch {
    return NextResponse.json({ ok: false, error: `Couldn't price ${symbol.toUpperCase()}.` }, { status: 400 });
  }
  if (candles.length < 2) {
    return NextResponse.json({ ok: false, error: `Not enough history for ${symbol.toUpperCase()}.` }, { status: 400 });
  }

  const entry = candles[0];
  const exit = candles[candles.length - 1];
  const units = amount / entry.close;
  const finalValue = units * exit.close;
  const pnl = finalValue - amount;
  const pnlPct = (pnl / amount) * 100;

  // peak/trough of the hypothetical position along the way
  let peak = candles[0].close;
  let maxDd = 0;
  for (const c of candles) {
    if (c.close > peak) peak = c.close;
    maxDd = Math.min(maxDd, (c.close - peak) / peak);
  }
  const best = candles.reduce((a, c) => (c.close > a.close ? c : a), candles[0]);

  return NextResponse.json({
    ok: true,
    data: {
      symbol: symbol.toUpperCase(),
      range,
      amount,
      units,
      entryPrice: entry.close,
      entryDay: entry.day,
      exitPrice: exit.close,
      exitDay: exit.day,
      finalValue,
      pnl,
      pnlPct,
      maxDrawdownPct: maxDd * 100,
      peakValue: units * best.close,
      peakDay: best.day,
      curve: candles.map((c) => ({ day: c.day, value: units * c.close })),
    },
  });
}
