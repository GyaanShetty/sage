"use client";

/**
 * Markets, as a list.
 *
 * The old page was a wall of twelve: indices, watchlist, crypto, currency,
 * movers, breadth, a sentiment dial, a sector heatmap, a correlation matrix,
 * a narrative, an events calendar and two live TV embeds. Almost none of it
 * changed a decision, and the two that did — what are my things worth, and
 * what is the wider weather — were the two smallest boxes on the screen.
 *
 * So: your names, the wider board, and a detail view when you want one.
 */

import { useState } from "react";
import { Frame } from "@/features/home/frame";
import { useFeed } from "@/lib/feed";
import { asArray } from "@/lib/as-array";
import { SymbolDrawer } from "./components/symbol-drawer";

interface Quote { symbol: string; name: string; price: number; changePct: number; currency: string }
interface Coin { symbol: string; name: string; price: number; change24h: number }
interface Reading { symbol: string; label: string; price: number; changePct: number; currency: string; band: number | null }
interface Group { key: string; label: string; rows: Reading[] }

const WATCH = ["^NSEI", "^BSESN", "^NSEBANK", "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "NVDA", "AAPL"];

const money = (v: number, ccy: string) => {
  const s = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
  return `${s}${v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
};

function Move({ pct }: { pct: number }) {
  return (
    <span className={`row-v num ${pct >= 0 ? "up" : "down"}`} style={{ width: 66, textAlign: "right" }}>
      {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

export function MarketsPage() {
  const quotes = useFeed<Quote[]>(`/api/market/quotes?symbols=${encodeURIComponent(WATCH.join(","))}`, { everyMs: 5 * 60_000 });
  const coins = useFeed<Coin[]>("/api/markets", { everyMs: 5 * 60_000 });
  const board = useFeed<{ groups: Group[] }>("/api/market/board", { everyMs: 5 * 60_000 });
  const [open, setOpen] = useState<string | null>(null);

  const rows = asArray<Quote>(quotes.data);
  const cs = asArray<Coin>(coins.data);

  return (
    <Frame title="Markets">
      {open && <SymbolDrawer symbol={open} onClose={() => setOpen(null)} />}

      <section>
        <div className="sec-h"><h2>Your names</h2></div>
        {quotes.loading && !rows.length && <p className="quiet">Loading…</p>}
        <div className="rows">
          {rows.map((q) => (
            /* The whole row opens the detail. Yahoo's own symbol, not the
               trimmed display one — "RELIANCE" is not a ticker anything can
               look up. */
            <button className="row" key={q.symbol} onClick={() => setOpen(q.symbol)}>
              <span className="row-main">
                <span className="row-t">{q.symbol.replace(/\.(NS|BO)$/, "")}</span>
                <span className="row-s">{q.name}</span>
              </span>
              <span className="row-v money">{money(q.price, q.currency)}</span>
              <Move pct={q.changePct} />
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="sec-h"><h2>Crypto</h2></div>
        {coins.loading && !cs.length && <p className="quiet">Loading…</p>}
        <div className="rows">
          {cs.map((c) => (
            <div className="row" key={c.symbol}>
              <span className="row-main">
                <span className="row-t">{c.symbol}</span>
                <span className="row-s">{c.name}</span>
              </span>
              <span className="row-v money">
                ${c.price.toLocaleString(undefined, { maximumFractionDigits: c.price < 100 ? 2 : 0 })}
              </span>
              <Move pct={c.change24h} />
            </div>
          ))}
        </div>
      </section>

      {board.data?.groups.map((g) => (
        <section key={g.key}>
          <div className="sec-h"><h2>{g.label}</h2></div>
          <div className="rows">
            {g.rows.map((r) => (
              <div className="row" key={r.symbol}>
                <span className="row-main"><span className="row-t">{r.label}</span></span>
                {r.band !== null && <span className="band" aria-hidden><i style={{ left: `${r.band * 100}%` }} /></span>}
                <span className="row-v money">{money(r.price, r.currency)}</span>
                <Move pct={r.changePct} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </Frame>
  );
}
