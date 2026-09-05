/**
 * Instruments.
 *
 * The reference design reuses about eight chart forms across thirty panels.
 * Building them once is the difference between this being tractable and being
 * thirty bespoke components that drift apart within a week.
 *
 * Rules they all obey:
 *
 * - Colour is functional, never decorative. Grey is the default; amber means
 *   active or warranting attention; red and green mean direction, and only
 *   direction. Nothing is encoded by colour alone — every coloured mark also
 *   carries a value or a label, so the chart survives being read by someone
 *   who cannot separate red from green.
 * - They size to their container. A fixed pixel width in a tiled grid is a
 *   promise you cannot keep.
 * - They render nothing rather than something fake. An instrument with no data
 *   draws its frame and says so; it never invents a plausible-looking series,
 *   because a panel that fakes activity makes every honest panel beside it
 *   less trustworthy.
 */

const SIGNAL = "var(--signal)";
const DOWN = "var(--down)";
const MARK = "var(--mark)";
const GRID = "var(--rule)";

function Empty({ label = "NO DATA" }: { label?: string }) {
  return <div className="inst-empty">{label}</div>;
}

/* ── bar strip ────────────────────────────────────────────────────────────
   The workhorse: a dense histogram under a panel. Reads as texture at a
   glance and as values on inspection, which is exactly what a terminal
   sparkline is for. */
export function BarStrip({
  data, height = 34, tone,
}: { data: number[]; height?: number; tone?: (v: number, i: number) => string }) {
  if (!data.length) return <Empty />;
  const max = Math.max(...data, 1);
  const w = 100 / data.length;
  return (
    <svg className="inst" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }}>
      {data.map((v, i) => {
        const h = Math.max((v / max) * height, 0.6);
        return (
          <rect
            key={i}
            x={i * w + w * 0.16} y={height - h}
            width={w * 0.68} height={h}
            fill={tone ? tone(v, i) : MARK}
          />
        );
      })}
    </svg>
  );
}

/* ── labelled bar rows ────────────────────────────────────────────────────
   Label left, bar centre, value and status right. The status word carries
   the same information as the bar's colour, deliberately. */
export interface BarRow { label: string; value: number; max?: number; note?: string; state?: "ok" | "warm" | "hot"; }

export function BarRows({ rows }: { rows: BarRow[] }) {
  if (!rows.length) return <Empty />;
  const ceiling = Math.max(...rows.map((r) => r.max ?? r.value), 1);
  const colour = { ok: MARK, warm: SIGNAL, hot: DOWN } as const;
  return (
    <div className="inst-rows">
      {rows.map((r, i) => (
        <div className="inst-row" key={i}>
          <span className="ir-k">{r.label}</span>
          <span className="ir-bar">
            <i style={{ width: `${Math.min((r.value / ceiling) * 100, 100)}%`, background: colour[r.state ?? "ok"] }} />
          </span>
          <span className="ir-v">{r.note ?? r.value}</span>
          {r.state && <span className={`ir-s ${r.state}`}>{r.state.toUpperCase().slice(0, 3)}</span>}
        </div>
      ))}
    </div>
  );
}

/* ── ring gauge ───────────────────────────────────────────────────────────
   A fraction of something bounded. Never used for an unbounded number, where
   a ring implies a ceiling that does not exist. */
export function Ring({
  pct, label, value, tone = SIGNAL, size = 26,
}: { pct: number; label: string; value: string; tone?: string; size?: number }) {
  const r = 10, c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(pct, 1));
  return (
    <div className="inst-ring">
      <svg width={size} height={size} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r={r} fill="none" stroke={GRID} strokeWidth="2.4" />
        <circle
          cx="12" cy="12" r={r} fill="none" stroke={tone} strokeWidth="2.4"
          strokeDasharray={`${c * clamped} ${c}`} strokeLinecap="butt"
          transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="ir-txt"><b>{value}</b><span>{label}</span></span>
    </div>
  );
}

/* ── waveform ─────────────────────────────────────────────────────────────
   A continuous trace. Used for signals that are genuinely continuous — a
   heart rate, a latency series — and not as a decorative squiggle. */
export function Wave({ data, height = 30, tone = DOWN }: { data: number[]; height?: number; tone?: string }) {
  if (data.length < 2) return <Empty />;
  const max = Math.max(...data), min = Math.min(...data), span = max - min || 1;
  const step = 100 / (data.length - 1);
  const d = data
    .map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(2)},${(height - ((v - min) / span) * height * 0.9 - height * 0.05).toFixed(2)}`)
    .join(" ");
  return (
    <svg className="inst" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }}>
      <path d={d} fill="none" stroke={tone} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ── segmented load bar ───────────────────────────────────────────────────
   Discrete buckets, each one a period. Reads left-to-right as time. */
export function Segments({
  data, trail,
}: { data: { v: number; state?: "ok" | "warm" | "hot" | "idle" }[]; trail?: string }) {
  if (!data.length) return <Empty />;
  const max = Math.max(...data.map((d) => d.v), 1);
  const colour = { idle: GRID, ok: MARK, warm: SIGNAL, hot: DOWN } as const;
  return (
    <div className="inst-seg">
      {data.map((d, i) => (
        <i key={i} style={{ flex: Math.max(d.v / max, 0.12), background: colour[d.state ?? "ok"] }} />
      ))}
      {trail && <span className="seg-trail">{trail}</span>}
    </div>
  );
}

/* ── contribution matrix ──────────────────────────────────────────────────
   Days as cells, intensity as luminance. Levels come from the source's own
   thresholds where it has them — shading relative to a personal maximum makes
   a quiet week look identical to a busy one. */
export function Matrix({
  cells, cols = 26,
}: { cells: { level: number; title?: string }[]; cols?: number }) {
  if (!cells.length) return <Empty />;
  const shade = ["var(--rule)", "rgba(244,245,247,.18)", "rgba(244,245,247,.34)", "rgba(244,245,247,.58)", "var(--foreground)"];
  return (
    <div className="inst-matrix" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {cells.map((c, i) => (
        <i key={i} title={c.title} style={{ background: shade[Math.max(0, Math.min(c.level, 4))] }} />
      ))}
    </div>
  );
}

/* ── progress bar ─────────────────────────────────────────────────────────
   One bounded fraction with its ends labelled. */
export function Progress({ pct, left, right }: { pct: number; left?: string; right?: string }) {
  return (
    <div className="inst-prog">
      <span className="ip-bar"><i style={{ width: `${Math.max(0, Math.min(pct, 1)) * 100}%` }} /></span>
      {(left || right) && (
        <span className="ip-ends"><span>{left}</span><span>{right}</span></span>
      )}
    </div>
  );
}

/* ── node field ───────────────────────────────────────────────────────────
   Nodes and the edges between them. Positions must come from real structure —
   a random scatter is a screensaver, and one fake instrument discredits every
   real one on the screen. */
export function Nodes({
  nodes, edges, height = 150,
}: { nodes: { x: number; y: number; w?: number }[]; edges: [number, number][]; height?: number }) {
  if (!nodes.length) return <Empty label="NO GRAPH" />;
  return (
    <svg className="inst" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }}>
      {edges.map(([a, b], i) => {
        const p = nodes[a], q = nodes[b];
        if (!p || !q) return null;
        return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={GRID} strokeWidth="0.3" vectorEffect="non-scaling-stroke" />;
      })}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={Math.max(n.w ?? 0.6, 0.4)} fill={MARK} />
      ))}
    </svg>
  );
}

/** Signed delta, coloured AND signed — the arrow does the work for anyone who
 *  cannot separate the two hues. */
export function Delta({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={up ? "delta up" : "delta down"}>
      {up ? "▲" : "▽"}{Math.abs(pct).toFixed(2)}%
    </span>
  );
}

/* ── donut ────────────────────────────────────────────────────────────────
   Allocation by weight.

   A pie is the wrong chart almost everywhere, and right here: the parts sum
   to a whole, which is the only case it is ever right for. Each arc carries
   its label and its percentage in the legend beside it, so the chart is not
   the only place the value exists — a ring read alone tells you "roughly a
   third" and never which third. */
export function Donut({
  slices, size = 92,
}: { slices: { label: string; value: number }[]; size?: number }) {
  const rows = slices.filter((s) => s.value > 0);
  const total = rows.reduce((a, s) => a + s.value, 0);
  if (!rows.length || total <= 0) return <Empty label="NO ALLOCATION" />;

  const R = 16, C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="dnt">
      <svg viewBox="0 0 40 40" style={{ width: size, height: size }} aria-hidden>
        {rows.map((s, i) => {
          const frac = s.value / total;
          const dash = C * frac;
          // -90° puts the first slice at twelve o'clock, where a reader
          // expects a pie to start.
          const el = (
            <circle
              key={s.label}
              cx="20" cy="20" r={R} fill="none" strokeWidth="7"
              stroke={i === 0 ? SIGNAL : `color-mix(in srgb, ${SIGNAL} ${Math.max(12, 90 - i * 18)}%, var(--muted))`}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 20 20)"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="dnt-legend">
        {rows.slice(0, 7).map((s, i) => (
          <div className="dnt-row" key={s.label}>
            <i style={{ background: i === 0 ? SIGNAL : `color-mix(in srgb, ${SIGNAL} ${Math.max(12, 90 - i * 18)}%, var(--muted))` }} />
            <span className="dnt-l">{s.label}</span>
            <span className="dnt-v">{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── line ─────────────────────────────────────────────────────────────────
   One or two series over time.

   Both are rebased to 100 at the start, because two lines at different
   absolute levels compare nothing: a portfolio at ₹4 lakh and an index at
   24,000 on one axis is a picture of the axis, not of the performance. */
export function Line({
  series, benchmark, height = 70,
}: { series: number[]; benchmark?: number[]; height?: number }) {
  if (series.length < 2) return <Empty label="NOT ENOUGH HISTORY" />;

  const rebase = (xs: number[]) => {
    const first = xs.find((x) => x > 0);
    return first ? xs.map((x) => (x / first) * 100) : xs;
  };

  const a = rebase(series);
  const b = benchmark && benchmark.length > 1 ? rebase(benchmark) : null;
  const all = b ? [...a, ...b] : a;
  const min = Math.min(...all), max = Math.max(...all), rng = max - min || 1;

  const path = (xs: number[]) =>
    xs.map((v, i) => `${(i / (xs.length - 1)) * 100},${28 - ((v - min) / rng) * 26}`).join(" ");

  return (
    <svg className="inst" viewBox="0 0 100 30" preserveAspectRatio="none" style={{ height }} aria-hidden>
      <line x1="0" y1="15" x2="100" y2="15" stroke={GRID} strokeWidth="0.3" />
      {b && <polyline points={path(b)} fill="none" stroke={MARK} strokeWidth="0.7" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      <polyline points={path(a)} fill="none" stroke={SIGNAL} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Bucket values into `count` equal-width bins.
 *
 * Exported and pure so the boundaries can be tested: an off-by-one here puts
 * the maximum in its own lonely bin at the right edge, which looks like a
 * fat tail and is arithmetic. The `min(…, count - 1)` is what prevents it.
 */
export function bucket(values: number[], count = 11): { from: number; to: number; n: number }[] {
  if (!values.length) return [];
  const min = Math.min(...values), max = Math.max(...values);
  const width = (max - min) / count || 1;
  const bins = Array.from({ length: count }, (_, i) => ({
    from: min + i * width, to: min + (i + 1) * width, n: 0,
  }));
  for (const v of values) {
    const i = Math.min(count - 1, Math.floor((v - min) / width));
    bins[i].n += 1;
  }
  return bins;
}

/* ── histogram ────────────────────────────────────────────────────────────
   The distribution of daily returns.

   Volatility is one number summarising this shape, and the shape is what you
   actually want: two portfolios with identical volatility can have wholly
   different tails, and only one of them will ruin your month. */
export function Histogram({ values, height = 60 }: { values: number[]; height?: number }) {
  const bins = bucket(values);
  if (!bins.length) return <Empty label="NO RETURNS YET" />;
  const peak = Math.max(1, ...bins.map((b) => b.n));

  return (
    <div className="hist" style={{ height }}>
      {bins.map((b, i) => (
        <span
          key={i}
          className={`hist-b${b.to <= 0 ? " dn" : ""}`}
          style={{ height: `${(b.n / peak) * 100}%` }}
          title={`${b.from.toFixed(2)}% to ${b.to.toFixed(2)}% · ${b.n} days`}
        />
      ))}
    </div>
  );
}

/* ── diverging ────────────────────────────────────────────────────────────
   Signed values around a zero line.

   A plain bar chart of profit and loss puts the biggest loss and the biggest
   gain at opposite ends of one axis and makes them look like the same kind of
   thing. Centred on zero, the direction is the geometry. */
export function Diverging({
  rows, height = 12,
}: { rows: { label: string; value: number }[]; height?: number }) {
  const live = rows.filter((r) => Number.isFinite(r.value));
  if (!live.length) return <Empty label="NO POSITIONS" />;
  const scale = Math.max(...live.map((r) => Math.abs(r.value))) || 1;

  return (
    <div className="dvg">
      {live.map((r) => {
        const frac = Math.abs(r.value) / scale;
        const up = r.value >= 0;
        return (
          <div className="dvg-row" key={r.label} style={{ height }}>
            <span className="dvg-l">{r.label}</span>
            <span className="dvg-track">
              <i
                className={up ? "up" : "dn"}
                style={{ width: `${frac * 50}%`, left: up ? "50%" : `${50 - frac * 50}%` }}
              />
            </span>
            <span className={`dvg-v ${up ? "up" : "dn"}`}>
              {up ? "+" : "−"}{Math.abs(r.value) >= 1000
                ? Math.round(Math.abs(r.value)).toLocaleString("en-IN")
                : Math.abs(r.value).toFixed(0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── radial ───────────────────────────────────────────────────────────────
   A rose plot: magnitude as spoke length around a cycle. The right form for
   anything whose x-axis wraps — hours of a day, days of a week, months of a
   year — where a bar chart puts Sunday and Monday at opposite ends of the
   page and hides that they are adjacent. */

/** Where a slice sits on the circle, in degrees clockwise from twelve. */
export function spokeAngle(index: number, count: number): number {
  if (count <= 0) return 0;
  // Modulo before scaling so an index past the end wraps to the start rather
  // than spiralling off — the seam is the whole point of a cyclic chart.
  return ((index % count) + count) % count * (360 / count);
}

/** Polar to cartesian, with 0° at twelve o'clock rather than at three. */
export function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function Radial({
  data,
  labels,
  size = 120,
  tone = SIGNAL,
}: {
  data: number[];
  labels?: string[];
  size?: number;
  tone?: string;
}) {
  if (!data.length || data.every((v) => !v)) return <Empty />;

  const cx = size / 2, cy = size / 2;
  const rMax = size / 2 - 12;
  const rMin = rMax * 0.22;
  const max = Math.max(...data);
  const step = 360 / data.length;

  return (
    <svg className="inst inst-radial" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet">
      {/* Two rings for scale, so a long spoke can be read as a proportion
          rather than only compared with its neighbours. */}
      {[0.55, 1].map((f) => (
        <circle key={f} cx={cx} cy={cy} r={rMin + (rMax - rMin) * f} fill="none" stroke={GRID} strokeWidth={0.5} />
      ))}

      {data.map((v, i) => {
        const a0 = spokeAngle(i, data.length) + 1.5;
        const a1 = spokeAngle(i, data.length) + step - 1.5;
        const r = rMin + (rMax - rMin) * (max ? v / max : 0);
        const p0 = polar(cx, cy, rMin, a0);
        const p1 = polar(cx, cy, r, a0);
        const p2 = polar(cx, cy, r, a1);
        const p3 = polar(cx, cy, rMin, a1);
        const big = a1 - a0 > 180 ? 1 : 0;
        return (
          <path
            key={i}
            d={`M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${big} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rMin} ${rMin} 0 ${big} 0 ${p0.x} ${p0.y} Z`}
            fill={tone}
            opacity={0.28 + 0.62 * (max ? v / max : 0)}
          />
        );
      })}

      {labels?.map((l, i) => {
        const p = polar(cx, cy, rMax + 6, spokeAngle(i, labels.length) + step / 2);
        return (
          <text key={i} x={p.x} y={p.y} fontSize={5.5} fill="var(--subtle)"
            textAnchor="middle" dominantBaseline="middle">{l}</text>
        );
      })}
    </svg>
  );
}

/* ── gauge ────────────────────────────────────────────────────────────────
   One arc against a target. Only for values that genuinely have a ceiling —
   a gauge implies a maximum, and putting an unbounded number in one invents
   a limit that does not exist. */
export function Gauge({
  value,
  max,
  label,
  unit = "",
  size = 96,
  tone = SIGNAL,
}: {
  value: number;
  max: number;
  label?: string;
  unit?: string;
  size?: number;
  tone?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 8;
  // A 270° sweep with the gap at the bottom: a full circle reads as a pie and
  // an open one reads as a dial.
  const SWEEP = 270, START = 225;
  const arc = (from: number, to: number) => {
    const a = polar(cx, cy, r, from);
    const b = polar(cx, cy, r, to);
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
  };

  return (
    <svg className="inst inst-gauge" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet">
      <path d={arc(START, START + SWEEP)} fill="none" stroke={GRID} strokeWidth={6} strokeLinecap="butt" />
      {pct > 0 && (
        <path d={arc(START, START + SWEEP * pct)} fill="none" stroke={tone} strokeWidth={6} strokeLinecap="butt" />
      )}
      <text x={cx} y={cy - 1} fontSize={size * 0.2} fill="var(--foreground)" textAnchor="middle"
        dominantBaseline="middle" style={{ fontVariantNumeric: "tabular-nums" }}>
        {Math.round(value)}{unit}
      </text>
      {label && (
        <text x={cx} y={cy + size * 0.17} fontSize={size * 0.085} fill="var(--subtle)"
          textAnchor="middle" letterSpacing="0.14em">{label.toUpperCase()}</text>
      )}
    </svg>
  );
}

/* ── area ─────────────────────────────────────────────────────────────────
   A trend with the ground filled in. For cumulative or level series where the
   quantity under the line means something; a plain line is better where it
   does not. */
export function Area({
  data,
  height = 56,
  tone = SIGNAL,
  baseline = true,
}: {
  data: number[];
  height?: number;
  tone?: string;
  baseline?: boolean;
}) {
  if (data.length < 2) return <Empty />;
  const W = 100;
  const max = Math.max(...data);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => height - ((v - min) / span) * (height - 4) - 2;

  const line = data.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");

  return (
    <svg className="inst inst-area" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="inst-area-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.34" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      {baseline && <line x1={0} y1={height - 2} x2={W} y2={height - 2} stroke={GRID} strokeWidth={0.5} />}
      <path d={`${line} L ${W} ${height} L 0 ${height} Z`} fill="url(#inst-area-g)" />
      <path d={line} fill="none" stroke={tone} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ── heat ─────────────────────────────────────────────────────────────────
   Did it happen that day, over weeks. The one chart that answers "am I
   actually keeping this up" — a total cannot, because a total hides whether
   thirty things happened on thirty days or all in one. */
export function Heat({
  days,
  weeks = 12,
  tone = SIGNAL,
}: {
  /** Newest last, one number per day. */
  days: number[];
  weeks?: number;
  tone?: string;
}) {
  if (!days.length) return <Empty />;
  const cells = days.slice(-weeks * 7);
  const max = Math.max(...cells, 1);
  const cols = Math.ceil(cells.length / 7);

  return (
    <svg className="inst inst-heat" viewBox={`0 0 ${cols * 4} 28`} preserveAspectRatio="xMidYMid meet">
      {cells.map((v, i) => (
        <rect
          key={i}
          x={Math.floor(i / 7) * 4}
          y={(i % 7) * 4}
          width={3.2}
          height={3.2}
          fill={v > 0 ? tone : GRID}
          // Intensity carries the amount; presence alone is the grid colour,
          // so an empty day and a quiet day never look the same.
          opacity={v > 0 ? 0.28 + 0.72 * (v / max) : 1}
        />
      ))}
    </svg>
  );
}

/* ── stack ────────────────────────────────────────────────────────────────
   Composition, as one bar. For "what is this made of" where the parts sum to
   a meaningful whole — never for unrelated quantities that merely fit. */
export function Stack({
  parts,
  height = 10,
}: {
  parts: { label: string; value: number; tone?: string }[];
  height?: number;
}) {
  const total = parts.reduce((t, p) => t + Math.max(0, p.value), 0);
  if (!total) return <Empty />;

  let x = 0;
  return (
    <div className="inst-stack">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" height={height}>
        {parts.map((p, i) => {
          const w = (Math.max(0, p.value) / total) * 100;
          const seg = <rect key={i} x={x} y={0} width={Math.max(0, w - 0.4)} height={height} fill={p.tone ?? SIGNAL} opacity={0.85 - i * 0.13} />;
          x += w;
          return seg;
        })}
      </svg>
      <div className="inst-stack-key">
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <span key={i}>
            <i style={{ background: p.tone ?? SIGNAL, opacity: 0.85 - i * 0.13 }} />
            {p.label}
            <b>{Math.round((p.value / total) * 100)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}
