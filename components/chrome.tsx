/**
 * Chrome: the marks around the data.
 *
 * The reference sheets Gyaan sent — the HUD symbol packs, the military
 * interface set — are almost entirely edge treatment. Corner brackets, hazard
 * stripes, registration crosshairs, serial strips, radar arcs. Very little of
 * it is content; nearly all of it is *framing*, and that framing is what makes
 * a dark rectangle read as an instrument rather than as a web page.
 *
 * So this file is deliberately presentational. Nothing here fetches, and
 * nothing here invents a value. `Serial` in particular takes only strings the
 * caller already knows to be true — a build sha, a route, a pane number —
 * because a fabricated "TRACK 006-2" would be the single dishonest thing on a
 * screen full of measurements, and once a viewer works out that one readout is
 * decorative, none of the others are trusted either. That rule is already set
 * by FrameRail; this keeps it.
 *
 * Everything is drawn from tokens that already exist (--signal, --danger,
 * --rule, --tick). No new colours: the references are amber, red and green on
 * black, which is the palette SAGE already has.
 */

import type { ReactNode } from "react";

/* ── BRACKETS ─────────────────────────────────────────────────────────────
   Four L-shaped corner marks. The single highest-yield element in the whole
   reference set: it costs four absolutely-positioned divs and it is most of
   what separates "panel" from "targeted". */
export function Brackets({ tone = "rule" }: { tone?: "rule" | "signal" | "danger" }) {
  return (
    <span className={`brk brk-${tone}`} aria-hidden>
      <i className="brk-tl" /><i className="brk-tr" /><i className="brk-bl" /><i className="brk-br" />
    </span>
  );
}

/* ── HAZARD ───────────────────────────────────────────────────────────────
   The diagonal caution stripe. Reserved for a pane in a real alert state:
   if everything is striped, nothing is, and the stripe stops meaning
   anything the moment it becomes wallpaper. */
export function Hazard({ tone = "signal" }: { tone?: "signal" | "danger" }) {
  return <span className={`hzd hzd-${tone}`} aria-hidden />;
}

/* ── CROSSHAIR ────────────────────────────────────────────────────────────
   A registration mark. Used at map corners and instrument origins, where a
   surveyor's tick genuinely marks something — the corner of the viewport. */
export function Crosshair({ size = 9 }: { size?: number }) {
  return (
    <svg className="xhair" width={size} height={size} viewBox="0 0 10 10" aria-hidden>
      <path d="M5 0V10M0 5H10" stroke="currentColor" strokeWidth="0.6" />
    </svg>
  );
}

/* ── RETICLE ──────────────────────────────────────────────────────────────
   The targeting ring: a circle broken at the axes, with tick marks. Marks a
   point of interest on the map — where he is, or what he asked about. */
export function Reticle({ size = 26, tone = "signal" }: { size?: number; tone?: "signal" | "live" }) {
  return (
    <svg className={`ret ret-${tone}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      {/* four arcs, gapped at the axes so the mark never hides its own centre */}
      {[0, 90, 180, 270].map((a) => (
        <path
          key={a}
          d="M20 4 A16 16 0 0 1 31.3 8.7"
          transform={`rotate(${a} 20 20)`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
      <circle cx="20" cy="20" r="2" fill="currentColor" />
      <path d="M20 0v5M20 35v5M0 20h5M35 20h5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/* ── ARC ──────────────────────────────────────────────────────────────────
   A ring that reads a real fraction — progress, bearing, load. The reference
   is full of spinning rings that measure nothing; this one takes a value, so
   the sweep means the same thing every time you look at it. */
export function Arc({
  pct,
  size = 44,
  label,
  tone = "signal",
}: { pct: number; size?: number; label?: string; tone?: "signal" | "live" | "danger" }) {
  const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  const R = 17;
  const C = 2 * Math.PI * R;
  return (
    <div className={`arcw arc-${tone}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" aria-hidden>
        <circle className="arc-bg" cx="20" cy="20" r={R} fill="none" strokeWidth="2" />
        <circle
          className="arc-fg" cx="20" cy="20" r={R} fill="none" strokeWidth="2"
          strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 20 20)" strokeLinecap="butt"
        />
      </svg>
      {label && <span className="arc-l">{label}</span>}
    </div>
  );
}

/* ── SERIAL ───────────────────────────────────────────────────────────────
   The registration strip: monospaced field/value pairs and a barcode rendered
   deterministically *from* the string beside it, so the bars are a function of
   the data rather than a random pattern that happens to look technical.

   If the bars were random they would change on every render, which is both a
   lie and a distraction — a barcode that never resolves to the same image is
   visibly not a barcode. */
export function Serial({ code, fields }: { code: string; fields?: [string, ReactNode][] }) {
  // Cheap deterministic hash → 24 bar widths. Same code, same bars, always.
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 16777619); }
  const bars = Array.from({ length: 24 }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 16777619);
    return 1 + ((h >>> (i % 8)) & 3);
  });

  return (
    <div className="serial">
      <span className="serial-bc" aria-hidden>
        {bars.map((w, i) => (
          <i key={i} style={{ width: w, opacity: i % 3 === 0 ? 0.9 : 0.45 }} />
        ))}
      </span>
      <span className="serial-c">{code}</span>
      {fields?.map(([k, v]) => (
        <span className="serial-f" key={k}>
          <b>{k}</b>{v}
        </span>
      ))}
    </div>
  );
}
