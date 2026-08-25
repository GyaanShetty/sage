"use client";

import { useCallback, useEffect, useState } from "react";
import { LineChart, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Point { day: string; value: number }
interface History {
  series: { day: string; value: number; cost: number; pnl: number }[];
  normalised: Point[];
  benchmark: Point[];
  benchmarkSymbol: string | null;
  periodPct: number | null;
  benchPct: number | null;
  alpha: number | null;
  points: number;
}

const RANGES = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "1Y", days: 365 },
];
const BENCHMARKS = [
  { label: "NIFTY", symbol: "^NSEI" },
  { label: "S&P", symbol: "^GSPC" },
  { label: "BTC", symbol: "BTC-USD" },
  { label: "None", symbol: "" },
];

const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

/** Equity curve with an optional benchmark overlay, both indexed to 100. */
export function EquityPanel() {
  const [days, setDays] = useState(90);
  const [bench, setBench] = useState("^NSEI");
  const [h, setH] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const j = await fetch(`/api/portfolio/history?days=${days}&benchmark=${encodeURIComponent(bench)}`)
      .then((r) => r.json()).catch(() => null);
    setH(j?.ok ? j.data : null);
    setLoading(false);
  }, [days, bench]);
  useEffect(() => { load(); }, [load]);

  const mine = h?.normalised ?? [];
  const bm = h?.benchmark ?? [];
  const all = [...mine.map((p) => p.value), ...bm.map((p) => p.value)];
  const min = all.length ? Math.min(...all) : 90;
  const max = all.length ? Math.max(...all) : 110;
  const pad = (max - min) * 0.12 || 4;
  const lo = min - pad, hi = max + pad;

  const path = (pts: Point[]) => {
    if (pts.length < 2) return "";
    return pts.map((p, i) => {
      const x = (i / (pts.length - 1)) * 100;
      const y = 100 - ((p.value - lo) / (hi - lo)) * 100;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  };

  const up = (h?.periodPct ?? 0) >= 0;

  /**
   * Hover inspection.
   *
   * A line chart you cannot interrogate is a picture of data rather than an
   * instrument: the shape is legible but no individual day is. The crosshair
   * snaps to the nearest sample rather than following the pointer freely, so
   * the readout always names a real observation instead of an interpolation.
   */
  const [probe, setProbe] = useState<number | null>(null);
  const xy = (i: number) => ({
    x: (i / Math.max(mine.length - 1, 1)) * 100,
    y: 100 - ((mine[i].value - lo) / (hi - lo)) * 100,
  });
  const onProbe = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mine.length < 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    setProbe(Math.max(0, Math.min(mine.length - 1, Math.round(frac * (mine.length - 1)))));
  };

  return (
    <div className="pp-card">
      <div className="pp-head">
        <LineChart className="size-3.5" />
        <h3>EQUITY CURVE</h3>
        <span className="pp-line" />
        <div className="pp-tabs">
          {RANGES.map((r) => (
            <button key={r.days} onClick={() => setDays(r.days)} className={cn("pp-tab", days === r.days && "on")}>{r.label}</button>
          ))}
        </div>
        <select value={bench} onChange={(e) => setBench(e.target.value)} className="pp-select">
          {BENCHMARKS.map((b) => <option key={b.symbol} value={b.symbol}>vs {b.label}</option>)}
        </select>
      </div>

      {loading && !h && <p className="pp-dim"><Loader2 className="inline size-3 animate-spin" /> loading…</p>}

      {h && mine.length < 2 && (
        <p className="pp-dim">
          Building history — SAGE records your total value once a day, so the curve fills in from here.
          {h.points === 1 ? " One day logged so far." : ` ${h.points} days logged.`}
        </p>
      )}

      {h && mine.length >= 2 && (
        <>
          <div
            className="pp-chartwrap"
            onPointerMove={onProbe}
            onPointerLeave={() => setProbe(null)}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pp-chart">
              {[25, 50, 75].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} className="pp-grid" />)}
              {bm.length >= 2 && <path d={path(bm)} className="pp-bench" vectorEffect="non-scaling-stroke" />}
              <path d={path(mine)} className={cn("pp-mine", up ? "up" : "dn")} vectorEffect="non-scaling-stroke" />

              {probe !== null && (
                <line x1={xy(probe).x} y1="0" x2={xy(probe).x} y2="100" className="pp-cross" />
              )}

            </svg>

            {/**
             * The endpoint marker lives outside the SVG on purpose.
             *
             * The chart uses preserveAspectRatio="none" on a 100x100 viewBox
             * stretched across a wide, short box — which is right for the line
             * (it fills the space) and fatal for anything meant to be round:
             * a <circle> inside it comes out as a flat ellipse. Positioning
             * the dot in HTML keeps it circular at any panel width.
             *
             * The latest value is the single most-read number on a time
             * series, so it gets a mark rather than just the end of a stroke.
             */}
            {mine.length >= 2 && (() => {
              const { x, y } = xy(probe ?? mine.length - 1);
              return (
                <span
                  className={cn("pp-dot", !up && "dn")}
                  style={{ left: `calc(8px + ${x}% * (100% - 42px) / 100%)`, top: `calc(8px + ${y}% * (100% - 22px) / 100%)` }}
                  aria-hidden="true"
                />
              );
            })()}

            {probe !== null && mine[probe] && (
              <span className="pp-readout">
                {mine[probe].value.toFixed(1)}
                {/* The day key as stored — already the owner's calendar day,
                    so it needs no re-derivation through a timezone. */}
                <span style={{ color: "var(--subtle)", marginLeft: 8 }}>{mine[probe].day}</span>
              </span>
            )}

            <span className="pp-axis top">{hi.toFixed(0)}</span>
            <span className="pp-axis bottom">{lo.toFixed(0)}</span>

            {/* Two series are never told apart by colour alone. */}
            <div className="pp-legend">
              <span><i className={up ? "" : "dn"} /> PORTFOLIO</span>
              {bm.length >= 2 && <span><i className="bench" /> {h.benchmarkSymbol ?? "BENCHMARK"}</span>}
            </div>
          </div>
          <div className="pp-stats">
            <div className="pp-stat">
              <span className="pp-sk">PORTFOLIO</span>
              <span className={cn("pp-sv", up ? "pf-up" : "pf-dn")}>{pct(h.periodPct)}</span>
            </div>
            {h.benchmarkSymbol && (
              <>
                <div className="pp-stat">
                  <span className="pp-sk">{BENCHMARKS.find((b) => b.symbol === h.benchmarkSymbol)?.label ?? "BENCH"}</span>
                  <span className="pp-sv">{pct(h.benchPct)}</span>
                </div>
                <div className="pp-stat">
                  <span className="pp-sk">ALPHA</span>
                  <span className={cn("pp-sv", (h.alpha ?? 0) >= 0 ? "pf-up" : "pf-dn")}>{pct(h.alpha)}</span>
                </div>
              </>
            )}
            <div className="pp-stat">
              <span className="pp-sk">DAYS</span>
              <span className="pp-sv">{h.points}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
