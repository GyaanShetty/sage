"use client";

/**
 * Money, in one block.
 *
 * The old build spent four panels and most of a second page on this: a
 * watchlist, a crypto list, indices, movers, currency, sectors, breadth, a
 * correlation matrix. Almost none of it changed what anyone did next.
 *
 * What is left is the two questions actually asked in the morning — where are
 * my things, and what is the weather they are in. Your names first, because
 * they are yours; the wider board behind a toggle, because it is context and
 * context does not need to be on screen to be available.
 */

import { useState } from "react";
import Link from "next/link";
import { useFeed } from "@/lib/feed";
import { asArray } from "@/lib/as-array";

interface Coin { symbol: string; name: string; price: number; change24h: number }
interface Quote { symbol: string; name: string; price: number; changePct: number; currency: string }
interface Reading { symbol: string; label: string; price: number; changePct: number; currency: string; band: number | null }
interface Group { key: string; label: string; rows: Reading[] }

const WATCH = ["^NSEI", "^BSESN", "RELIANCE.NS", "TCS.NS", "NVDA", "AAPL"];

const money = (v: number, ccy: string) => {
  const s = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
  return `${s}${v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
};

function Move({ pct }: { pct: number }) {
  return (
    <span className={`row-v num ${pct >= 0 ? "up" : "down"}`} style={{ width: 62, textAlign: "right" }}>
      {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

export function Money() {
  const [wide, setWide] = useState(false);

  const quotes = useFeed<Quote[]>(`/api/market/quotes?symbols=${encodeURIComponent(WATCH.join(","))}`, { everyMs: 5 * 60_000 });
  const coins = useFeed<Coin[]>("/api/markets", { everyMs: 5 * 60_000 });
  // Only asked for once it is wanted — it is four groups of upstream calls and
  // nobody opens SAGE to find out where the thirty-year is.
  const board = useFeed<{ groups: Group[] }>(wide ? "/api/market/board" : null, { everyMs: 5 * 60_000 });

  const rows = asArray<Quote>(quotes.data);
  const cs = asArray<Coin>(coins.data);

  return (
    <section>
      <div className="sec-h">
        <h2>Markets</h2>
        <button className="sec-more" onClick={() => setWide((w) => !w)} aria-expanded={wide}>
          {wide ? "Less" : "The wider board"}
        </button>
      </div>

      {quotes.loading && !rows.length && <p className="quiet">Loading…</p>}

      <div className="rows">
        {rows.map((q) => (
          <div className="row" key={q.symbol}>
            <span className="row-main">
              <span className="row-t">{q.symbol.replace(/\.(NS|BO)$/, "")}</span>
              <span className="row-s">{q.name}</span>
            </span>
            <span className="row-v money">{money(q.price, q.currency)}</span>
            <Move pct={q.changePct} />
          </div>
        ))}
        {cs.map((c) => (
          <div className="row" key={c.symbol}>
            <span className="row-main">
              <span className="row-t">{c.symbol}</span>
              <span className="row-s">{c.name}</span>
            </span>
            <span className="row-v money">${c.price.toLocaleString(undefined, { maximumFractionDigits: c.price < 100 ? 2 : 0 })}</span>
            <Move pct={c.change24h} />
          </div>
        ))}
      </div>

      {wide && (
        <div style={{ marginTop: "var(--s4)" }}>
          {board.loading && <p className="quiet">Reading the board…</p>}
          {board.data?.groups.map((g) => (
            <div key={g.key}>
              <div className="sec-h" style={{ marginTop: "var(--s4)" }}><h2>{g.label}</h2></div>
              <div className="rows">
                {g.rows.map((r) => (
                  <div className="row" key={r.symbol}>
                    <span className="row-main"><span className="row-t">{r.label}</span></span>
                    {/* Where it sits in its own year. A bare price says
                        nothing; a position says the thing you wanted. */}
                    {r.band !== null && (
                      <span className="band" aria-hidden><i style={{ left: `${r.band * 100}%` }} /></span>
                    )}
                    <span className="row-v money">{money(r.price, r.currency)}</span>
                    <Move pct={r.changePct} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!wide && (
        <Link className="sec-more" href="/markets" style={{ display: "inline-block", marginTop: "var(--s3)" }}>
          Open markets →
        </Link>
      )}
    </section>
  );
}
