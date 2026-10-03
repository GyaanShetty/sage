"use client";

import { type BoardDoc, type Rect, contentBounds } from "@/core/board/types";

/**
 * The whole board, small, with a box showing where you are.
 *
 * An infinite canvas has one failure mode above all others: you pan somewhere,
 * lose the rest of the work, and cannot find your way back except by zooming
 * out until something appears. A minimap is the fix — it is the only control
 * on the board that answers "where am I" rather than "what can I do".
 *
 * Drawn from the document rather than by scaling the live SVG: a scaled copy
 * of the real thing would render every stroke twice on every pointer move,
 * which on a busy board is exactly when the canvas can least afford it. Here a
 * stroke is one line from its first point to its last — wrong as a drawing,
 * right as a map, and it costs nothing.
 */
export function Minimap({
  doc,
  view,
  size,
  onJump,
}: {
  doc: BoardDoc;
  view: { x: number; y: number; k: number };
  /** The canvas's own pixel size, to place the viewport rectangle. */
  size: { w: number; h: number };
  onJump: (x: number, y: number) => void;
}) {
  const bounds = contentBounds(doc, 80);
  if (!bounds || (!doc.nodes.length && !doc.strokes.length)) return null;

  const W = 168, H = 110;
  const k = Math.min(W / bounds.w, H / bounds.h);
  const ox = (W - bounds.w * k) / 2 - bounds.x * k;
  const oy = (H - bounds.h * k) / 2 - bounds.y * k;
  const at = (r: Rect) => ({ x: r.x * k + ox, y: r.y * k + oy, w: r.w * k, h: r.h * k });

  // Where the screen currently sits, in board coordinates.
  const port = at({ x: -view.x / view.k, y: -view.y / view.k, w: size.w / view.k, h: size.h / view.k });

  return (
    <svg
      className="bd-map"
      width={W}
      height={H}
      onPointerDown={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        // Click anywhere to centre the view there — the point of a map is that
        // it is also the fastest way to travel.
        onJump((e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k);
      }}
    >
      <rect x={0} y={0} width={W} height={H} fill="var(--panel, #0c0d0f)" />
      {doc.strokes.map((s) => {
        const n = s.pts.length / 2;
        if (n < 2) return null;
        return (
          <line
            key={s.id}
            x1={s.pts[0] * k + ox} y1={s.pts[1] * k + oy}
            x2={s.pts[(n - 1) * 2] * k + ox} y2={s.pts[(n - 1) * 2 + 1] * k + oy}
            stroke="var(--subtle, #5c5d64)" strokeWidth={1}
          />
        );
      })}
      {doc.nodes.map((n) => {
        const r = at(n);
        return (
          <rect
            key={n.id}
            x={r.x} y={r.y} width={Math.max(2, r.w)} height={Math.max(2, r.h)}
            fill={n.kind === "frame" ? "none" : "var(--rule-strong, rgba(244,245,247,0.2))"}
            stroke={n.kind === "frame" ? "var(--subtle, #5c5d64)" : "none"}
          />
        );
      })}
      <rect
        x={port.x} y={port.y} width={port.w} height={port.h}
        fill="rgba(255,59,48,0.08)" stroke="var(--signal, #ff3b30)" strokeWidth={1}
      />
    </svg>
  );
}
