"use client";

/**
 * Markets as a list, the way the reference draws it: one row per asset, a
 * badge, a sparkline, the price, the move.
 *
 * The four-cell grid it replaces could show four assets and spent most of a
 * tile doing it. A row is 30px, so the same space carries ten — and the
 * column of percentages down the right edge is the thing you actually scan,
 * which a 2x2 grid cannot give you at all.
 */

import { useState } from "react";
import { shareJson } from "@/lib/share";
import { Pane, Empty } from "@/components/pane";
import Link from "next/link";
import { Wave } from "@/components/instruments";
import { useLive } from "@/lib/live";
import { asArray } from "@/lib/as-array";

interface Coin { symbol: string; name?: string; price: number; change24h: number; spark?: number[] }
/** Mirrors infrastructure/markets Stock — `change`, not `changePct`. */
interface Quote { symbol: string; name?: string; price: number; change: number; currency?: string }

interface RowData {
  key: string; sym: string; name: string;
  /** null when the source gave no change for this quote — not zero. */
  price: number; pct: number | null; ccy: string; spark?: number[];
}

/** A quote that arrives without a move must not become NaN%. */
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function money(n: number, ccy: string) {
  const digits = n >= 1000 ? 2 : n >= 1 ? 2 : 4;
  return ccy + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function MarketsList({ n, limit = 10 }: { n?: number; limit?: number }) {
  const [rows, setRows] = useState<RowData[]>([]);

  useLive(() => Promise.all([
    shareJson("/api/markets").then((j) => asArray<Coin>(j?.data)),
    fetch("/api/stocks").then((r) => r.json()).then((j) => asArray<Quote>(j?.data)),
  ]).then(([coins, stocks]) => {
    setRows([
      ...coins.map((c) => ({
        key: `c:${c.symbol}`, sym: c.symbol, name: c.name ?? c.symbol,
        price: c.price, pct: num(c.change24h), ccy: "$", spark: c.spark,
      })),
      ...stocks.map((s) => ({
        key: `s:${s.symbol}`, sym: s.symbol, name: s.name ?? s.symbol,
        price: s.price, pct: num(s.change), ccy: s.currency === "INR" ? "₹" : "$",
      })),
    ]);
  }).catch(() => {}), { everyMs: 120_000 });

  return (
    <Pane n={n} title="Markets" status={<Link className="pane-go" href="/markets">LIVE</Link>} live={rows.length > 0}>
      {rows.length === 0
        ? <Empty reason="Waiting on the first quote" />
        : (
          <div className="mkl">
            {rows.slice(0, limit).map((r) => {
              const up = (r.pct ?? 0) >= 0;
              return (
                <div className="mkl-row" key={r.key}>
                  <span className="mkl-badge" aria-hidden>{r.sym.slice(0, 1)}</span>
                  <span className="mkl-sym" title={r.name}>{r.sym}</span>
                  <span className="mkl-spark">
                    {r.spark?.length
                      ? <Wave data={r.spark} height={18} tone={r.pct === null ? "var(--muted)" : up ? "var(--up)" : "var(--down)"} />
                      : null}
                  </span>
                  <span className="mkl-price">{money(r.price, r.ccy)}</span>
                  {/* The sign is on the number as well as in the colour: a
                      screen read by someone who cannot separate green from red
                      still says which way it went. */}
                  {/* "—" says the move is unknown. Rendering it as 0.00%
                      would state something the source never said. */}
                  <span className={`mkl-pct ${r.pct === null ? "flat" : up ? "up" : "down"}`}>
                    {r.pct === null ? "—" : `${up ? "+" : "−"}${Math.abs(r.pct).toFixed(2)}%`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
    </Pane>
  );
}
