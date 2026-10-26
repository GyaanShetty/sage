"use client";

/**
 * Markets, on the source that actually answers.
 *
 * This read `/api/markets` (CoinGecko, keyless and rate-limited) and
 * `/api/stocks` (Alpha Vantage, which needs a key SAGE does not have), so
 * on most loads it had nothing and said "waiting on the first quote". The
 * whole time `/api/market/quotes` — Yahoo, no key, crypto AND Indian
 * equities AND indices, with a 28-point intraday spark on every one —
 * was sitting there answering in full. One endpoint, and the richest live
 * data in SAGE stops being invisible.
 *
 * What it draws, in the order the eye should take it:
 *
 *   · BREADTH across the top. How many up, how many down, as one bar. The
 *     single most useful thing about a watchlist is whether the whole
 *     market moved or just your one holding, and no amount of reading
 *     rows gives you that.
 *   · a FILLED spark per instrument, because the shape of the day is the
 *     reading — a flat −0.4% and a −0.4% that fell 3% and recovered are
 *     not the same day.
 *   · the MOVE as a bar as well as a number, scaled across the board, so
 *     the biggest mover is visible without comparing eight decimals.
 *
 * Every percentage carries its own sign. Green and red sit at ΔE 10.7
 * under deuteranopia, which is a hint, not a reading — the sign is the
 * reading.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { Pane, Empty } from "@/components/pane";
import { useLive } from "@/lib/live";
import { asArray } from "@/lib/as-array";

/** Mirrors infrastructure/markets/quotes.ts. */
interface Quote {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePct: number;
  currency?: string;
  spark?: number[];
}

/*
 * What he watches, in one request.
 *
 * Yahoo takes crypto, Indian equities and indices in the same call, so
 * the split between "markets" and "stocks" that forced two endpoints and
 * two failure modes simply goes away.
 */
const SYMBOLS = [
  "BTC-USD", "ETH-USD", "SOL-USD", "LINK-USD",
  "^NSEI", "^BSESN",
  "RELIANCE.NS", "NVDA", "AAPL",
].join(",");

const SHORT: Record<string, string> = {
  "BTC-USD": "BTC", "ETH-USD": "ETH", "SOL-USD": "SOL", "LINK-USD": "LINK",
  "^NSEI": "NIFTY", "^BSESN": "SENSEX", "RELIANCE.NS": "RELIANCE",
};

const sym = (s: string) => SHORT[s] ?? s.replace(/\.(NS|BO)$/, "");
const ccy = (c?: string) => (c === "INR" ? "₹" : "$");

function money(n: number, c: string) {
  const digits = n >= 1000 ? 0 : n >= 1 ? 2 : 4;
  return c + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * A filled area spark.
 *
 * Drawn here rather than with the shared <Wave> because this one needs a
 * fill under the line and a baseline at the open — the area between the
 * two IS the day's move, which a bare polyline cannot show.
 */
function Spark({ data, up, w = 72, h = 22 }: { data: number[]; up: boolean; w?: number; h?: number }) {
  if (data.length < 2) return <span className="mk-spark-empty" aria-hidden />;
  const lo = Math.min(...data), hi = Math.max(...data);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (data.length - 1)) * w;
  const y = (v: number) => h - ((v - lo) / span) * (h - 2) - 1;
  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const open = y(data[0]);
  const tone = up ? "var(--up)" : "var(--down)";
  return (
    <svg className="mk-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {/* The open, as a dotted rule. Everything above it is gain. */}
      <line x1="0" y1={open} x2={w} y2={open} className="mk-open" />
      <polygon points={`0,${open} ${line} ${w},${open}`} fill={tone} opacity={0.17} />
      <polyline points={line} fill="none" stroke={tone} strokeWidth="1.25"
                vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function MarketsList({ n, limit = 10 }: { n?: number; limit?: number }) {
  const [rows, setRows] = useState<Quote[] | null>(null);

  const load = useCallback(() =>
    fetch(`/api/market/quotes?symbols=${encodeURIComponent(SYMBOLS)}`)
      .then((r) => r.json())
      .then((j) => setRows(asArray<Quote>(j?.data)))
      /* A failed poll leaves the last good board on screen. Blanking a
         price because one request timed out is worse than a stale one. */
      .catch(() => setRows((cur) => cur ?? [])),
  []);

  /* Ninety seconds. Yahoo caches on its own side and these are intraday
     bars, so faster buys nothing but requests. */
  useLive(load, { everyMs: 90_000 });

  const list = (rows ?? []).slice(0, limit);
  const up = list.filter((q) => q.changePct >= 0).length;
  const down = list.length - up;
  /* The move bars share one scale, so "the biggest mover" is a length
     rather than a number you have to find. */
  const worst = Math.max(0.01, ...list.map((q) => Math.abs(q.changePct || 0)));

  return (
    <Pane
      n={n}
      title="Markets"
      status={<Link className="pane-go" href="/markets">LIVE</Link>}
      live={list.length > 0}
    >
      {rows === null
        ? <Empty reason="Waiting on the first quote" />
        : list.length === 0
          ? <Empty reason="No quotes came back" />
          : (
            <div className="mk">
              {/* Breadth. One bar: how much of the board is green. */}
              <div className="mk-breadth" role="img"
                   aria-label={`${up} up, ${down} down`}>
                <span className="mk-br-bar">
                  <i className="up" style={{ width: `${(up / list.length) * 100}%` }} />
                  <i className="down" style={{ width: `${(down / list.length) * 100}%` }} />
                </span>
                <span className="mk-br-k num">
                  <b className="up">{up}▲</b> <b className="down">{down}▼</b>
                </span>
              </div>

              <div className="mk-rows">
                {list.map((q) => {
                  const rising = (q.changePct ?? 0) >= 0;
                  const pct = Number.isFinite(q.changePct) ? q.changePct : null;
                  return (
                    <div className="mk-row" key={q.symbol}>
                      <span className="mk-sym" title={q.name ?? q.symbol}>{sym(q.symbol)}</span>
                      <Spark data={q.spark ?? []} up={rising} />
                      <span className="mk-price num">{money(q.price, ccy(q.currency))}</span>
                      <span className="mk-move">
                        <i
                          className={rising ? "up" : "down"}
                          style={{ width: `${(Math.abs(pct ?? 0) / worst) * 100}%` }}
                        />
                      </span>
                      {/* The sign is on the number as well as in the colour:
                          a screen read by someone who cannot separate green
                          from red still says which way it went. "—" means the
                          source gave no move, which is not the same as 0.00%. */}
                      <span className={`mk-pct num ${pct === null ? "flat" : rising ? "up" : "down"}`}>
                        {pct === null ? "—" : `${rising ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
    </Pane>
  );
}
