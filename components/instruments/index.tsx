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
