"use client";

/**
 * The weather the market closed in.
 *
 * Your own six names tell you what happened to you. These tell you what
 * happened — VIX for how frightened everyone is, the US futures for what
 * tomorrow morning in India has already decided overnight, crude and gold for
 * input costs and for fear, and the long end for what money costs.
 *
 * Each row carries where it sits in its own 52-week range, which is the
 * reading that makes a bare price mean something without a chart beside it:
 * "crude at 92" says nothing, "crude at 92, four-fifths of the way up its
 * year" says the thing you actually wanted to know.
 */

import { useState } from "react";
import { Pane, Empty } from "@/components/pane";
import { useFeed } from "@/lib/feed";
import { Fresh } from "@/components/fresh";
import { sound } from "@/lib/sound";

interface Reading {
  symbol: string; label: string; price: number; changePct: number;
  currency: string; band: number | null; low52: number | null; high52: number | null;
}
interface Group { key: string; label: string; rows: Reading[] }

const money = (v: number, ccy: string) => {
  const sym = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
  return `${sym}${v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
};

export function BoardPanel({ n }: { n?: number }) {
  const feed = useFeed<{ groups: Group[]; live: number }>("/api/market/board", { everyMs: 5 * 60_000 });
  const groups = feed.data?.groups ?? [];
  const [only, setOnly] = useState<string | null>(null);
  const shown = only ? groups.filter((g) => g.key === only) : groups;

  return (
    <Pane n={n} title="The Board" status={<Fresh feed={feed} />} live={(feed.data?.live ?? 0) > 0}>
      <div className="wire">
        <div className="wire-tabs" role="tablist" aria-label="Section">
          <button role="tab" aria-selected={only === null} className={only === null ? "on" : undefined}
                  onClick={() => { setOnly(null); sound.detent(); }}>ALL</button>
          {groups.map((g) => (
            <button key={g.key} role="tab" aria-selected={only === g.key} className={only === g.key ? "on" : undefined}
                    onClick={() => { setOnly(g.key); sound.detent(); }} onPointerEnter={() => sound.hover()}>
              {g.label.toUpperCase()}
            </button>
          ))}
        </div>

        {groups.length === 0
          ? <Empty reason={feed.loading ? "Reading the board…" : "The board feed is unreachable right now"} />
          : (
            <div className="bd-rows">
              {shown.map((g) => (
                <div key={g.key} className="bd-group">
                  {only === null && <div className="bd-gh">{g.label}</div>}
                  {g.rows.map((r) => (
                    <div className="bd-row" key={r.symbol} title={`${r.symbol}${r.low52 && r.high52 ? ` · 52w ${money(r.low52, r.currency)}–${money(r.high52, r.currency)}` : ""}`}>
                      <span className="bd-k">{r.label}</span>
                      {/* The year, as a track with the price on it. A number
                          between a low and a high is a position, and a
                          position is a thing you read at a glance. */}
                      <span className="bd-band" aria-hidden>
                        {r.band !== null && <i style={{ left: `${r.band * 100}%` }} />}
                      </span>
                      <span className="bd-v">{money(r.price, r.currency)}</span>
                      <span className={`bd-c${r.changePct >= 0 ? " up" : " down"}`}>
                        {r.changePct >= 0 ? "▲" : "▽"} {Math.abs(r.changePct).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
      </div>
    </Pane>
  );
}
