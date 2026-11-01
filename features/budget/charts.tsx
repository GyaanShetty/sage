"use client";

/**
 * The budget page's charts.
 *
 * Hand-drawn SVG rather than a charting library: every one of these is
 * forty lines, the page already has a design system to obey, and a
 * library would arrive with its own colours, its own tooltips and its
 * own idea of a legend — all of which would have to be fought.
 *
 * ── On colour
 *
 * The interface has a budget of exactly two hues: one red for what is
 * over or wrong, one green reserved for savings being met. A six-slice
 * pie would need six, so the slices are RANKED instead — sorted largest
 * to smallest and shaded light to dark down a grey ramp whose steps are
 * 30 points apart and all clear 3:1 on this ground. That is a legal
 * sequential encoding rather than a categorical one dressed up, and
 * identity comes from the direct labels, which is where it should come
 * from anyway. Red appears only on a category that is over its limit.
 *
 * Every fill is separated from its neighbour by a 2px gap of the surface
 * showing through, because two adjacent fills with no gap read as one
 * shape.
 */

import { useState } from "react";

/* Light → dark, ranked. Checked against the card ground: 17.9:1 down to
   3.04:1, so even the sixth slice is a mark rather than a smudge. */
export const RANK = ["#f2f2f2", "#d4d4d4", "#b6b6b6", "#999999", "#7b7b7b", "#5d5d5d"];
export const shadeFor = (i: number) => RANK[Math.min(i, RANK.length - 1)];

export const rupees = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const short = (n: number) =>
  n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));

/* ══ DONUT ════════════════════════════════════════════════════════════ */

export interface Slice { label: string; value: number; over?: boolean }

/**
 * Share of the month, by category.
 *
 * A donut rather than a pie: the hole carries the total, which is the
 * number people actually want while looking at the shares. Slices past
 * the sixth fold into "Other" instead of becoming unreadable slivers —
 * nine two-degree wedges is a texture, not a chart.
 */
export function Donut({ slices, total, size = 190 }: { slices: Slice[]; total: number; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!slices.length || total <= 0) return <p className="bg-quiet">Nothing logged this month</p>;

  const head = slices.slice(0, 6);
  const restVal = slices.slice(6).reduce((a, s) => a + s.value, 0);
  const shown: Slice[] = restVal > 0
    ? [...head, { label: `Other (${slices.length - 6})`, value: restVal }]
    : head;

  const r = size / 2 - 4, inner = r * 0.62, cx = size / 2, cy = size / 2;
  /* A 2px gap at the rim, converted to the angle it subtends there. */
  const gap = (2 / r);
  let angle = -Math.PI / 2;

  const arcs = shown.map((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = angle + gap / 2, a1 = angle + sweep - gap / 2;
    angle += sweep;
    if (a1 <= a0) return null;
    const p = (rad: number, radius: number) =>
      `${(cx + Math.cos(rad) * radius).toFixed(2)},${(cy + Math.sin(rad) * radius).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(a0, inner)} Z`;
    return { d, s, i };
  }).filter(Boolean) as { d: string; s: Slice; i: number }[];

  const lit = hover != null ? shown[hover] : null;

  return (
    <div className="bg-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}
           role="img" aria-label="Share of this month's spend by category">
        {arcs.map(({ d, s, i }) => (
          <path
            key={s.label} d={d}
            fill={s.over ? "var(--down)" : shadeFor(i)}
            opacity={hover == null || hover === i ? 1 : 0.35}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${s.label} · ${rupees(s.value)} · ${((s.value / total) * 100).toFixed(0)}%`}</title>
          </path>
        ))}
        {/* The hole is the headline: hovering a slice swaps it for that
            slice, so the centre always answers "how much is this". */}
        <text x={cx} y={cy - 2} className="bg-dn-v" textAnchor="middle">
          {short(lit ? lit.value : total)}
        </text>
        <text x={cx} y={cy + 13} className="bg-dn-k" textAnchor="middle">
          {lit ? lit.label.slice(0, 14) : "this month"}
        </text>
      </svg>

      {/* Direct labels, so identity never depends on telling two greys
          apart. Ordered exactly as the slices are. */}
      <ul className="bg-dn-key">
        {shown.map((s, i) => (
          <li key={s.label}
              className={hover === i ? "on" : undefined}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}>
            <i style={{ background: s.over ? "var(--down)" : shadeFor(i) }} />
            <span>{s.label}</span>
            <b className="num">{((s.value / total) * 100).toFixed(0)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ══ MONTH HISTOGRAM ══════════════════════════════════════════════════ */

export interface MonthBar { month: string; total: number; partial: boolean }

/**
 * Twelve months of spend, with the typical month drawn through them.
 *
 * The median line is the point: a bar chart on its own tells you March
 * was ₹48,000 and leaves you to work out whether that is a lot. The
 * month in progress is outlined rather than filled, because comparing a
 * part-month to whole ones is the easiest wrong conclusion here.
 */
export function MonthHistogram({ months, median, h = 150 }: { months: MonthBar[]; median: number; h?: number }) {
  if (!months.length) return <p className="bg-quiet">No history yet</p>;
  /*
   * Headroom above the tallest bar.
   *
   * Scaling exactly to the peak puts the biggest month flush against the
   * ceiling and squashes the rest into the top quarter, where months
   * that differ by 25% look identical. A tenth of slack is enough for
   * the shape to separate, and the bars still start at zero — the axis
   * is not the thing to cheat when values are close.
   */
  const peak = Math.max(1, ...months.map((m) => m.total), median) * 1.1;
  const label = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(y, mo - 1, 1));
  };

  return (
    <div className="bg-hist" style={{ height: h }}>
      {median > 0 && (
        <span className="bg-hist-med" style={{ bottom: `${(median / peak) * 100}%` }}>
          <b className="num">{short(median)}</b>
        </span>
      )}
      <div className="bg-hist-bars">
        {months.map((m) => (
          <span className={`bg-hb${m.partial ? " partial" : ""}`} key={m.month}
                title={`${m.month} · ${rupees(m.total)}${m.partial ? " so far" : ""}`}>
            <i style={{ height: `${m.total ? Math.max(2, (m.total / peak) * 100) : 0}%` }} />
            <u>{label(m.month)}</u>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ══ DAILY BARS ═══════════════════════════════════════════════════════ */

export interface Day { day: number; spent: number; weekend: boolean; future: boolean }

/**
 * Every day of the month.
 *
 * Separate from the cumulative curve on purpose: a running total hides
 * the single ₹9,000 Saturday inside a gentle slope, and that one day is
 * the thing worth seeing. Weekends are marked because for most people
 * that is the pattern, and a chart that makes you count columns to find
 * Saturday has wasted the encoding.
 */
export function DailyBars({ days, h = 120 }: { days: Day[]; h?: number }) {
  if (!days.length) return <p className="bg-quiet">No days yet</p>;
  const peak = Math.max(1, ...days.map((d) => d.spent));
  const spent = days.filter((d) => !d.future);
  const avg = spent.length ? spent.reduce((a, d) => a + d.spent, 0) / spent.length : 0;

  return (
    <div className="bg-daily" style={{ height: h }}>
      {avg > 0 && <span className="bg-daily-avg" style={{ bottom: `${(avg / peak) * 100}%` }} />}
      <div className="bg-daily-bars">
        {days.map((d) => (
          <span
            className={`bg-db${d.weekend ? " wknd" : ""}${d.future ? " future" : ""}${d.spent > avg * 2.2 && !d.future ? " spike" : ""}`}
            key={d.day}
            title={`${d.day} · ${d.spent ? rupees(d.spent) : "nothing"}${d.weekend ? " · weekend" : ""}`}
          >
            <i style={{ height: `${d.spent ? Math.max(2, (d.spent / peak) * 100) : 0}%` }} />
          </span>
        ))}
      </div>
      <div className="bg-daily-sc">
        <span>1</span>
        <span className="num">avg {short(avg)}/day</span>
        <span>{days.length}</span>
      </div>
    </div>
  );
}

/* ══ RADAR ════════════════════════════════════════════════════════════ */

export interface Axis { label: string; actual: number; limit: number }

/**
 * Budget as a shape.
 *
 * Five axes, each a category, each scaled to its OWN limit — so the
 * budget is a regular pentagon at 100% and the month is whatever shape
 * it turns out to be. Anything poking outside the pentagon is over, and
 * that is readable in a glance in a way five progress bars are not.
 *
 * Normalising per-axis is what makes this legal. A radar with raw rupees
 * on every spoke would let the one category with a big limit dominate
 * the shape and say nothing; the comparison here is like-for-like
 * because every axis means "share of what you allowed yourself".
 *
 * Capped at 150% so one runaway category cannot flatten the rest into
 * the middle, and the cap is labelled so nobody reads a clipped spoke
 * as the true value.
 */
export function Radar({ axes, size = 250 }: { axes: Axis[]; size?: number }) {
  const use = axes.slice(0, 5);
  if (use.length < 3) return <p className="bg-quiet">Needs at least three budget lines</p>;

  /*
   * The plot is small relative to the box on purpose.
   *
   * Each spoke carries a two-line label outside it, and at r = size/2−34
   * those labels ran into the shape at the sides and into the caption at
   * the bottom. The ring is what has to shrink: a radar whose labels
   * overlap its own geometry is unreadable however big the pentagon is.
   */
  const cx = size / 2, cy = size / 2, r = size / 2 - 56;
  const CAP = 150;
  const n = use.length;
  const at = (i: number, frac: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r * frac, cy + Math.sin(a) * r * frac] as const;
  };
  const ring = (frac: number) =>
    use.map((_, i) => at(i, frac).join(",")).join(" ");

  const pts = use.map((a, i) => {
    const pct = a.limit > 0 ? (a.actual / a.limit) * 100 : 0;
    return { ...a, pct, frac: Math.min(pct, CAP) / CAP };
  });
  const shape = pts.map((p, i) => at(i, p.frac).join(",")).join(" ");
  const budgetRing = 100 / CAP;
  const anyOver = pts.some((p) => p.pct > 100);

  return (
    <svg className="bg-radar" viewBox={`0 0 ${size} ${size + 16}`} width="100%" height={size + 16}
         role="img" aria-label="Spend against each category's limit">
      {[0.33, 0.66, 1].map((f) => (
        <polygon key={f} points={ring(f)} className="bg-rd-grid" />
      ))}
      {pts.map((_, i) => {
        const [x, y] = at(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="bg-rd-spoke" />;
      })}

      {/* The budget itself: a regular pentagon at 100% of every limit. */}
      <polygon points={ring(budgetRing)} className="bg-rd-budget" />

      <polygon points={shape} className={anyOver ? "bg-rd-shape over" : "bg-rd-shape"} />
      {pts.map((p, i) => {
        const [x, y] = at(i, p.frac);
        return <circle key={p.label} cx={x} cy={y} r="2.5"
                       className={p.pct > 100 ? "bg-rd-dot over" : "bg-rd-dot"}>
          <title>{`${p.label} · ${rupees(p.actual)} of ${rupees(p.limit)} · ${Math.round(p.pct)}%`}</title>
        </circle>;
      })}

      {pts.map((p, i) => {
        const [x, y] = at(i, 1.22);
        return (
          <text key={p.label} x={x} y={y}
                className={p.pct > 100 ? "bg-rd-lab over" : "bg-rd-lab"}
                textAnchor={x < cx - 6 ? "end" : x > cx + 6 ? "start" : "middle"}>
            {p.label.slice(0, 11)}
            <tspan className="bg-rd-pct" dy="9" x={x}
                   textAnchor={x < cx - 6 ? "end" : x > cx + 6 ? "start" : "middle"}>
              {Math.round(p.pct)}%
            </tspan>
          </text>
        );
      })}
      <text x={cx} y={size + 12} className="bg-rd-cap" textAnchor="middle">
        inner ring = your limit · capped at {CAP}%
      </text>
    </svg>
  );
}
