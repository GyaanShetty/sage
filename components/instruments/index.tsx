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
const UP = "var(--up)";
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
