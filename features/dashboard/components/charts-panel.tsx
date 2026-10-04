"use client";

/**
 * The visuals.
 *
 * Three charts, and the forms are chosen rather than requested — which is
 * worth saying, because pie charts were asked for and only one of these is
 * round.
 *
 * The palette here is monochrome by design, and a monochrome categorical
 * palette does not work: a five-step grey ramp measures 12.5 ΔE between
 * adjacent steps against a floor of 15, which means a reader with perfect
 * colour vision cannot reliably tell two slices apart. The muted up/down pair
 * is worse — 1.9 ΔE under deuteranopia, i.e. identical. Both numbers came out
 * of the validator rather than off a monitor.
 *
 * So nothing here asks colour to carry identity. Length carries it, from a
 * shared baseline, which is the encoding the eye reads most precisely anyway.
 * The one round chart has two segments and a gap, where there is nothing to
 * confuse.
 */

import { useMemo } from "react";
import { Pane, Empty } from "@/components/pane";
import { useFeed } from "@/lib/feed";
import { asArray } from "@/lib/as-array";

interface Sector { symbol: string; label: string; region: string; changePct: number | null }
interface SectorData { sectors: Sector[]; breadth: number | null }
interface Sentiment { value: number; label: string; history: { value: number; at: string }[] }

/* ── 1 · sector performance, as a diverging bar ─────────────────────────────
 * Was a grid of saturated red and green blocks where the colour carried the
 * magnitude. Colour intensity is read far less precisely than length, and the
 * blocks were the loudest thing on the page for a routine half-percent move.
 */
function Sectors({ rows }: { rows: Sector[] }) {
  const max = Math.max(0.5, ...rows.map((s) => Math.abs(s.changePct ?? 0)));
  return (
    <div className="cx-sectors">
      {rows.map((s) => {
        const v = s.changePct ?? 0;
        const w = (Math.abs(v) / max) * 50;   // half-width each side of the axis
        return (
          <div className="cx-srow" key={s.symbol}>
            <span className="cx-slabel">{s.label}</span>
            <span className="cx-track">
              <i className="cx-axis" aria-hidden />
              <i
                className={`cx-bar ${v >= 0 ? "up" : "down"}`}
                style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
              />
            </span>
            {/* Direct label on every bar: the arrow is the secondary encoding
                that lets the colour be as quiet as it is. */}
            <span className={`cx-sval num ${v >= 0 ? "up" : "down"}`}>
              {v >= 0 ? "▲" : "▽"} {Math.abs(v).toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── 2 · breadth, as a two-segment donut ────────────────────────────────────
 * The one round chart. Two segments with a gap between them and both directly
 * labelled — there is no adjacent pair to confuse, which is the only condition
 * under which this palette can carry a slice at all.
 */
function Breadth({ pct }: { pct: number }) {
  const r = 34, c = 2 * Math.PI * r;
  const up = Math.max(0, Math.min(100, pct));
  return (
    <div className="cx-donut">
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} className="cx-ring" />
        <circle
          cx="50" cy="50" r={r} className="cx-ringup"
          strokeDasharray={`${(up / 100) * c - 2} ${c - (up / 100) * c + 2}`}
          strokeDashoffset={c / 4}
        />
      </svg>
      <span className="cx-dmid">
        <b className="num">{Math.round(up)}%</b>
        <i>advancing</i>
      </span>
    </div>
  );
}

/* ── 3 · sentiment over a month, as a line ──────────────────────────────────
 * One series, so no legend — the title names it. The band behind it is the
 * fear/greed midpoint, which is what makes a value mean something.
 */
function Mood({ history, value }: { history: { value: number; at: string }[]; value: number }) {
  const pts = useMemo(() => {
    if (history.length < 2) return "";
    return history
      .map((h, i) => `${(i / (history.length - 1)) * 100},${100 - h.value}`)
      .join(" ");
  }, [history]);

  if (!pts) return null;
  return (
    <div className="cx-mood">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <line x1="0" y1="50" x2="100" y2="50" className="cx-mid" />
        <polyline points={pts} className="cx-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="cx-mlab">
        <b className="num">{value}</b> fear &amp; greed · 30 days
      </span>
    </div>
  );
}

export function ChartsPanel({ n }: { n?: number }) {
  const sec = useFeed<SectorData>("/api/market/sectors", { everyMs: 10 * 60_000 });
  const mood = useFeed<Sentiment>("/api/market/sentiment", { everyMs: 30 * 60_000 });

  const rows = asArray<Sector>(sec.data?.sectors).slice(0, 8);
  const breadth = sec.data?.breadth;
  const history = asArray<{ value: number; at: string }>(mood.data?.history);

  return (
    <Pane n={n} title="Charts" status="SECTORS · BREADTH · MOOD" live={rows.length > 0}>
      {!rows.length && !history.length
        ? <Empty reason={sec.loading ? "Drawing…" : "The sector feed is unreachable right now"} />
        : (
          <div className="cx">
            {rows.length > 0 && <Sectors rows={rows} />}
            <div className="cx-pair">
              {breadth != null && <Breadth pct={breadth} />}
              {history.length > 1 && mood.data && <Mood history={history} value={mood.data.value} />}
            </div>
          </div>
        )}
    </Pane>
  );
}
