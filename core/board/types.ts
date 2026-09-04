/**
 * The board document, and the geometry that makes it work.
 *
 * Pure on purpose — no database import — because every function here is needed
 * inside the canvas, which is a client component. `core/places` splits for the
 * same reason: the db module drags Node built-ins into anything importing it.
 *
 * Everything below is also the half that cannot be checked by looking at the
 * screen. A simplifier that drops a corner and an anchor that picks the wrong
 * side both produce a drawing that is *plausible* and wrong, which is exactly
 * the kind of bug that survives a demo.
 */

export type NodeKind = "sticky" | "text" | "file" | "image" | "frame";

export interface BoardNode {
  id: string;
  kind: NodeKind;
  x: number; y: number; w: number; h: number;
  text?: string;
  /** Palette slot, not a hex value — so a palette change moves every board. */
  tone?: Tone;
  /**
   * For file and image nodes: what /api/files gave back.
   *
   * `readable`/`chars` rather than a text preview, because the endpoint strips
   * the extracted body from its response — a preview field here could only
   * ever be undefined.
   */
  file?: { name: string; path: string; mime: string; size: number; readable?: boolean; chars?: number };
}

export type Tone = "signal" | "amber" | "cyan" | "green" | "plain";

/** Which face of a box an arrow leaves or meets. */
export type Side = "t" | "r" | "b" | "l";

export interface Edge {
  id: string;
  /** A node id, or a free point for an arrow that ends in space. */
  from: { node: string } | { x: number; y: number };
  to: { node: string } | { x: number; y: number };
  tone?: Tone;
  label?: string;
}

export interface Stroke {
  id: string;
  /** Flat [x,y,x,y,…]. Flat because a stroke is mostly numbers and the pair
   *  objects triple the JSON for no gain — and the document is one row. */
  pts: number[];
  tone?: Tone;
  w?: number;
}

export interface BoardDoc {
  id: string;
  title: string;
  /** Bumped on every accepted save. The guard against two devices. */
  version: number;
  nodes: BoardNode[];
  edges: Edge[];
  strokes: Stroke[];
  createdAt: string;
  updatedAt: string;
}

/** What the index needs, without dragging every node over the wire. */
export interface BoardSummary {
  id: string; title: string; version: number;
  nodes: number; strokes: number;
  createdAt: string; updatedAt: string;
}

export function summarise(doc: BoardDoc): BoardSummary {
  return {
    id: doc.id, title: doc.title, version: doc.version,
    nodes: doc.nodes.length, strokes: doc.strokes.length,
    createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}

export function emptyBoard(title: string): BoardDoc {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: title.trim().slice(0, 80) || "Untitled board",
    version: 1,
    nodes: [], edges: [], strokes: [],
    createdAt: now, updatedAt: now,
  };
}

/* ── geometry ─────────────────────────────────────────────────────────── */

export interface Rect { x: number; y: number; w: number; h: number }

export function boundsOf(nodes: BoardNode[]): Rect | null {
  if (!nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function centreOf(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * Where an arrow heading toward `target` should touch the box `r`.
 *
 * The naive version draws to the centre and lets the arrowhead disappear under
 * the node. This walks the ray from the box's centre toward the target and
 * stops at the face it crosses, so the head always lands *on* the border and
 * points at the thing it means.
 *
 * The side is decided by comparing the ray's slope against the box's own
 * aspect ratio — not by the angle alone, which is the common bug: a wide box
 * approached from 45° is met on its side, a tall one on its top, and an
 * angle-only test gets one of the two wrong at every aspect ratio but 1:1.
 */
export function anchorPoint(r: Rect, target: { x: number; y: number }): { x: number; y: number; side: Side } {
  const c = centreOf(r);
  const dx = target.x - c.x;
  const dy = target.y - c.y;

  // Degenerate: the target is the centre. Pick a face rather than divide by
  // zero and hand back NaN, which renders as an arrow that vanishes.
  if (dx === 0 && dy === 0) return { x: c.x, y: r.y, side: "t" };

  const hw = r.w / 2, hh = r.h / 2;
  // Scale factor to the vertical faces vs the horizontal ones; the smaller
  // one is the face the ray actually reaches first.
  const tx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const ty = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty);

  const x = c.x + dx * t;
  const y = c.y + dy * t;
  const side: Side = tx <= ty ? (dx > 0 ? "r" : "l") : (dy > 0 ? "b" : "t");
  return { x, y, side };
}

/**
 * Ramer–Douglas–Peucker, on the flat point array.
 *
 * A pointer event fires every few milliseconds, so a thirty-second scribble is
 * several thousand points. Stored raw, one page of ink is larger than the rest
 * of the document put together and the save starts failing the size guard —
 * for a curve the eye cannot tell from one with a tenth as many points.
 *
 * Endpoints are always kept, and so is any point further than `epsilon` from
 * the chord — which is what preserves corners. A simplifier that rounds off
 * the corner of a hand-drawn box is worse than no simplifier, because the
 * drawing silently stops being the drawing.
 */
export function simplify(pts: number[], epsilon = 1): number[] {
  const n = pts.length / 2;
  if (n < 3 || epsilon <= 0) return pts.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  // Iterative rather than recursive: a long stroke is thousands of points and
  // the recursive form can overflow the stack on the pathological case.
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;

    const ax = pts[a * 2], ay = pts[a * 2 + 1];
    const bx = pts[b * 2], by = pts[b * 2 + 1];
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;

    let worst = -1, worstD = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2], py = pts[i * 2 + 1];
      let d: number;
      if (len2 === 0) {
        // A closed loop back to the start: distance from the point itself.
        d = Math.hypot(px - ax, py - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
        d = Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
      }
      if (d > worstD) { worstD = d; worst = i; }
    }

    if (worstD > epsilon && worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** Screen pixels → board coordinates, given the current pan and zoom. */
export function screenToBoard(
  sx: number, sy: number,
  view: { x: number; y: number; k: number },
): { x: number; y: number } {
  return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
}

/** Does a stroke pass within `r` of a point? Used by the eraser. */
export function strokeNear(s: Stroke, x: number, y: number, r: number): boolean {
  const n = s.pts.length / 2;
  for (let i = 0; i < n; i++) {
    if (Math.hypot(s.pts[i * 2] - x, s.pts[i * 2 + 1] - y) <= r) return true;
    // Also test the segment, or a fast drag leaves gaps the eraser slips
    // through and strokes survive being crossed out.
    if (i + 1 < n) {
      const ax = s.pts[i * 2], ay = s.pts[i * 2 + 1];
      const bx = s.pts[i * 2 + 2], by = s.pts[i * 2 + 3];
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy;
      if (len2 > 0) {
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
        if (Math.hypot(x - (ax + t * vx), y - (ay + t * vy)) <= r) return true;
      }
    }
  }
  return false;
}

/**
 * The save guard.
 *
 * Vercel refuses a body over ~4.5MB, and the failure that produces is a save
 * that simply stops working with nothing on screen to say so. Refusing earlier,
 * with a number, means the board can be trimmed while it is still openable.
 */
export const MAX_DOC_BYTES = 2 * 1024 * 1024;

export function tooLarge(doc: BoardDoc): number | null {
  const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
  return bytes > MAX_DOC_BYTES ? bytes : null;
}
