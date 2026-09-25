import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * One symbol's price history, for the detail chart behind a market row.
 *
 * Same keyless Yahoo chart endpoint the quotes route already reads, asked for
 * a longer window. A 28-point sparkline is enough to say "up today" and not
 * enough to answer "up from where?", which is the question a row you can click
 * is implicitly promising to answer.
 */

export interface Series {
  symbol: string;
  name: string;
  currency: string;
  range: string;
  /** Closes, oldest first, nulls dropped. */
  points: { t: number; v: number }[];
  high: number;
  low: number;
  first: number;
  last: number;
}

/** Yahoo's own range/interval pairs. An interval too fine for a range is refused. */
const WINDOWS: Record<string, { range: string; interval: string }> = {
  "1d": { range: "1d", interval: "5m" },
  "5d": { range: "5d", interval: "30m" },
  "1mo": { range: "1mo", interval: "1d" },
  "6mo": { range: "6mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
  "5y": { range: "5y", interval: "1wk" },
};

const cache = new Map<string, { at: number; s: Series | null }>();
const TTL = 5 * 60_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol")?.trim();
  const key = url.searchParams.get("range") ?? "1mo";
  const win = WINDOWS[key];

  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  if (!win) return NextResponse.json({ ok: false, error: `range must be one of ${Object.keys(WINDOWS).join(", ")}` }, { status: 400 });

  const ck = `${symbol}:${key}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) {
    return hit.s
      ? NextResponse.json({ ok: true, data: hit.s })
      : NextResponse.json({ ok: false, error: "No history for that symbol." }, { status: 404 });
  }

  try {
    const res = await proxyFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?interval=${win.interval}&range=${win.range}&includePrePost=false`,
      { signal: AbortSignal.timeout(9000), headers: { "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as {
      chart?: { result?: {
        meta?: { currency?: string; shortName?: string; symbol?: string };
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }[] };
    };
    const r = j.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const closes = r?.indicators?.quote?.[0]?.close ?? [];

    // A gap in the series is a missing bar, not a zero — pairing on index and
    // dropping the nulls keeps the x axis honest where a holiday sits.
    const points = ts
      .map((t, i) => ({ t: t * 1000, v: closes[i] }))
      .filter((p): p is { t: number; v: number } => typeof p.v === "number");

    if (points.length < 2) throw new Error("no data");

    const values = points.map((p) => p.v);
    const s: Series = {
      symbol: r?.meta?.symbol ?? symbol,
      name: r?.meta?.shortName ?? symbol,
      currency: r?.meta?.currency ?? "",
      range: key,
      points,
      high: Math.max(...values),
      low: Math.min(...values),
      first: values[0],
      last: values[values.length - 1],
    };
    cache.set(ck, { at: Date.now(), s });
    return NextResponse.json({ ok: true, data: s });
  } catch {
    // Remember the failure briefly so a dead symbol is not retried on every
    // click, but not for the full window — upstream hiccups recover.
    cache.set(ck, { at: Date.now() - TTL + 60_000, s: hit?.s ?? null });
    if (hit?.s) return NextResponse.json({ ok: true, data: hit.s });
    return NextResponse.json({ ok: false, error: "Couldn't reach the price feed for that symbol." }, { status: 502 });
  }
}
