"use client";

/**
 * What a market row opens.
 *
 * Every row on this page carried a 28-point sparkline and nothing else, so
 * "NVDA ▲ 2.1%" answered "up today" and left "up from where?" — the obvious
 * next question — with nowhere to go. Clicking a row now opens the series
 * behind it at six ranges, with the range's own high, low and move, and SAGE's
 * read of why on request.
 *
 * The chart is drawn as an SVG polyline rather than pulled from a chart
 * library: one line, one axis label pair, no interaction beyond hover. A
 * charting dependency for that is 60KB to draw what fifteen lines of path
 * arithmetic already draws.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, X, Sparkles } from "lucide-react";
import "./intel.css";

interface Profile {
  symbol: string; name: string; currency: string; exchange: string;
  price: number; changePct: number;
  dayLow: number | null; dayHigh: number | null;
  low52: number | null; high52: number | null; band: number | null;
  volume: number | null;
  fundamentals: {
    peRatio: number | null; marketCap: number | null; dividendYield: number | null;
    eps: number | null; bookValue: number | null; profitMargin: number | null;
    sector: string | null; industry: string | null; asOf: string;
  } | null;
  note?: string;
}

interface Series {
  symbol: string; name: string; currency: string; range: string;
  points: { t: number; v: number }[];
  high: number; low: number; first: number; last: number;
}

const RANGES = ["1d", "5d", "1mo", "6mo", "1y", "5y"] as const;

const money = (v: number, ccy: string) => {
  const sym = ccy === "INR" ? "₹" : ccy === "USD" ? "$" : "";
  return `${sym}${v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
};

function Chart({ s }: { s: Series }) {
  const { points, high, low } = s;
  // A flat series would divide by zero; a single pixel of range is enough to
  // draw it as the straight line it is.
  const span = high - low || 1;
  const path = points
    .map((p, i) => `${(i / (points.length - 1)) * 100},${100 - ((p.v - low) / span) * 96 - 2}`)
    .join(" ");
  const up = s.last >= s.first;

  return (
    <div className="sd-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <polyline points={path} fill="none" stroke={up ? "#4fb477" : "#e07070"} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="sd-ax hi">{money(high, s.currency)}</span>
      <span className="sd-ax lo">{money(low, s.currency)}</span>
    </div>
  );
}

export function SymbolDrawer({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [range, setRange] = useState<string>("1mo");
  const [s, setS] = useState<Series | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prof, setProf] = useState<Profile | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [whyBusy, setWhyBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setS(null); setErr(null);
    fetch(`/api/market/history?symbol=${encodeURIComponent(symbol)}&range=${range}`, { signal: AbortSignal.timeout(12_000) })
      .then((r) => r.json())
      .then((j) => { if (!live) return; if (j?.ok) setS(j.data); else setErr(j?.error ?? "No history."); })
      .catch(() => { if (live) setErr("Couldn't reach the price feed."); });
    return () => { live = false; };
  }, [symbol, range]);

  /*
   * The numbers behind the line.
   *
   * Separate from the series because it does not change with the range —
   * the 52-week band and the valuation are the same whichever window the
   * chart is showing, and refetching them on every tab press would spend the
   * valuation quota four times for one look.
   */
  useEffect(() => {
    let live = true;
    setProf(null);
    fetch(`/api/market/profile?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => r.json())
      .then((j) => { if (live && j?.ok) setProf(j.data); })
      .catch(() => {});
    return () => { live = false; };
  }, [symbol]);

  // Escape closes it, because a panel over the page that only closes by mouse
  // is a trap for anyone not using one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const explain = useCallback(async () => {
    setWhyBusy(true);
    const j = await fetch("/api/market/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol }),
      signal: AbortSignal.timeout(30_000),
    }).then((r) => r.json()).catch(() => null);
    setWhyBusy(false);
    setWhy(j?.ok ? j.data.explanation : (j?.error ?? "Couldn't get a read on it right now."));
  }, [symbol]);

  const move = s ? ((s.last - s.first) / s.first) * 100 : null;

  return (
    <div className="sd-scrim" onClick={onClose} role="presentation">
      <div className="sd" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${symbol} detail`}>
        <div className="sd-hd">
          <span className="sd-sym">{s?.symbol ?? symbol}</span>
          <span className="sd-name">{s?.name ?? ""}</span>
          <span className="mk-line" />
          <button className="sd-x" onClick={onClose} aria-label="Close">
            <X className="size-3.5" />
          </button>
        </div>

        <div className="sd-ranges" role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} role="tab" aria-selected={r === range} className={r === range ? "on" : undefined} onClick={() => setRange(r)}>
              {r.toUpperCase()}
            </button>
          ))}
        </div>

        {!s && !err && <p className="mk-dim">Loading {range.toUpperCase()}…</p>}
        {err && <p className="mk-dim">{err}</p>}
        {s && (
          <>
            <div className="sd-figs">
              <span className="sd-last">{money(s.last, s.currency)}</span>
              {move !== null && (
                <span className={move >= 0 ? "up" : "down"}>
                  {move >= 0 ? "▲" : "▽"} {Math.abs(move).toFixed(2)}% over {range.toUpperCase()}
                </span>
              )}
              <span className="mk-line" />
              <span className="sd-hl">H {money(s.high, s.currency)} · L {money(s.low, s.currency)}</span>
            </div>
            <Chart s={s} />
          </>
        )}

        {prof && (
          <div className="sd-facts">
            {/* Where it sits in its own year, as a position rather than two
                numbers you have to subtract in your head. */}
            {prof.band !== null && prof.low52 !== null && prof.high52 !== null && (
              <div className="sd-52">
                <span className="sd-52k">52-WEEK</span>
                <span className="sd-52lo">{money(prof.low52, prof.currency)}</span>
                <span className="sd-52track"><i style={{ left: `${prof.band * 100}%` }} /></span>
                <span className="sd-52hi">{money(prof.high52, prof.currency)}</span>
              </div>
            )}
            <dl className="sd-dl">
              {prof.dayLow !== null && prof.dayHigh !== null && (
                <div><dt>Day</dt><dd>{money(prof.dayLow, prof.currency)} – {money(prof.dayHigh, prof.currency)}</dd></div>
              )}
              {prof.volume !== null && <div><dt>Volume</dt><dd>{prof.volume.toLocaleString()}</dd></div>}
              {prof.exchange && <div><dt>Listed</dt><dd>{prof.exchange}</dd></div>}
              {prof.fundamentals?.peRatio != null && <div><dt>P/E</dt><dd>{prof.fundamentals.peRatio.toFixed(1)}</dd></div>}
              {prof.fundamentals?.eps != null && <div><dt>EPS</dt><dd>{prof.fundamentals.eps}</dd></div>}
              {prof.fundamentals?.marketCap != null && (
                <div><dt>Mkt cap</dt><dd>{money(prof.fundamentals.marketCap, prof.currency)}</dd></div>
              )}
              {prof.fundamentals?.dividendYield != null && (
                <div><dt>Yield</dt><dd>{(prof.fundamentals.dividendYield * 100).toFixed(2)}%</dd></div>
              )}
              {prof.fundamentals?.sector && <div><dt>Sector</dt><dd>{prof.fundamentals.sector}</dd></div>}
            </dl>
            {/* Say why a number is absent rather than leaving a gap — a
                missing row and a rationed feed look identical otherwise. */}
            {prof.note && <p className="sd-note">{prof.note}</p>}
          </div>
        )}

        <div className="sd-why">
          {!why && (
            <button className="mk-btn" onClick={explain} disabled={whyBusy}>
              {whyBusy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} WHY IS IT MOVING
            </button>
          )}
          {why && <div className="mk-prose">{why.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>}
        </div>
      </div>
    </div>
  );
}
