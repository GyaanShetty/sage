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
