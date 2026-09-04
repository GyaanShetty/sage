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

export type NodeKind = "sticky" | "text" | "rect" | "ellipse" | "file" | "image" | "frame" | "live";

export interface BoardNode {
  id: string;
  kind: NodeKind;
  x: number; y: number; w: number; h: number;
  text?: string;
  /** Text nodes carry their own size — a title and a caption are both "text". */
  fontSize?: number;
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
  /**
   * For live nodes: which part of SAGE this card is bound to.
   *
   * This is the thing no other whiteboard can do — a node that *is* your open
   * tasks or your holdings and stays current, rather than a note about them
   * that was true the day you wrote it.
   */
  live?: { source: string; arg?: string };
}

export type Tone = "signal" | "amber" | "cyan" | "green" | "plain";

/** Which face of a box an arrow leaves or meets. */
export type Side = "t" | "r" | "b" | "l";

export interface Edge {
  id: string;
  /** Which face each end leaves from. Auto by default; pinned once dragged. */
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

/* ── arranging ────────────────────────────────────────────────────────── */

export const GRID = 12;

/**
 * Snap a coordinate to the grid, unless overridden.
 *
 * The override matters as much as the snap: a diagram sometimes needs a node
 * three pixels off the grid, and a canvas that refuses is a canvas you fight.
 * Alt holds it off, the way every drawing tool does it.
 */
export function snap(v: number, on = true): number {
  if (!on) return v;
  // `+ 0` normalises -0, which Math.round produces for any small negative.
  // It survives into the document and makes coordinate comparisons disagree
  // with the eye: Object.is(-0, 0) is false, so a node "at zero" can fail an
  // equality check against zero.
  return Math.round(v / GRID) * GRID + 0;
}

/**
 * Do two rectangles overlap at all?
 *
 * Intersection, not containment. A marquee that only selects fully-enclosed
 * nodes means dragging a box over four notes selects two of them, and the hand
 * reads that as the selection being broken rather than as a rule.
 */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** The rectangle between two points, in any drag direction. */
export function rectBetween(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export type Align = "left" | "hcentre" | "right" | "top" | "vmiddle" | "bottom";

/** Line the given nodes up. Returns only the nodes that moved. */
export function alignNodes(nodes: BoardNode[], how: Align): BoardNode[] {
  const b = boundsOf(nodes);
  if (!b || nodes.length < 2) return nodes;
  return nodes.map((n) => {
    switch (how) {
      case "left": return { ...n, x: b.x };
      case "right": return { ...n, x: b.x + b.w - n.w };
      case "hcentre": return { ...n, x: b.x + b.w / 2 - n.w / 2 };
      case "top": return { ...n, y: b.y };
      case "bottom": return { ...n, y: b.y + b.h - n.h };
      case "vmiddle": return { ...n, y: b.y + b.h / 2 - n.h / 2 };
    }
  });
}

/**
 * Space nodes evenly along an axis.
 *
 * The gaps are equalised, not the centres. Equal centre spacing looks wrong
 * the moment the nodes are different sizes — which on a board of notes and
 * file cards they always are.
 */
export function distributeNodes(nodes: BoardNode[], axis: "x" | "y"): BoardNode[] {
  if (nodes.length < 3) return nodes;
  const size = axis === "x" ? ("w" as const) : ("h" as const);
  const sorted = [...nodes].sort((a, b) => a[axis] - b[axis]);

  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = (last[axis] + last[size]) - first[axis];
  const used = sorted.reduce((t, n) => t + n[size], 0);
  const gap = (span - used) / (sorted.length - 1);

  let cursor = first[axis];
  const moved = new Map<string, number>();
  for (const n of sorted) {
    moved.set(n.id, cursor);
    cursor += n[size] + gap;
  }
  // Returned in the caller's order, so a selection does not reshuffle.
  return nodes.map((n) => ({ ...n, [axis]: moved.get(n.id) ?? n[axis] }));
}

/**
 * Everything the board occupies, with padding — for zoom-to-fit and export.
 *
 * Ink counts. A board whose only content is a drawing has no nodes, and a
 * bounds function that ignores strokes would report nothing to fit and leave
 * the export blank.
 */
export function contentBounds(doc: BoardDoc, pad = 40): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let any = false;

  for (const n of doc.nodes) {
    any = true;
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
  }
  for (const s of doc.strokes) {
    for (let i = 0; i < s.pts.length; i += 2) {
      any = true;
      x0 = Math.min(x0, s.pts[i]); y0 = Math.min(y0, s.pts[i + 1]);
      x1 = Math.max(x1, s.pts[i]); y1 = Math.max(y1, s.pts[i + 1]);
    }
  }
  for (const e of doc.edges) {
    for (const end of [e.from, e.to]) {
      if ("node" in end) continue;
      any = true;
      x0 = Math.min(x0, end.x); y0 = Math.min(y0, end.y);
      x1 = Math.max(x1, end.x); y1 = Math.max(y1, end.y);
    }
  }
  if (!any) return null;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/** The view that fits `r` inside a viewport of `vw`×`vh`. */
export function fitView(r: Rect, vw: number, vh: number, maxK = 1): { x: number; y: number; k: number } {
  if (r.w <= 0 || r.h <= 0) return { x: 0, y: 0, k: 1 };
  const k = Math.min(maxK, vw / r.w, vh / r.h);
  return { k, x: vw / 2 - (r.x + r.w / 2) * k, y: vh / 2 - (r.y + r.h / 2) * k };
}

/**
 * Alignment guides: the edges of other nodes this one is nearly level with.
 *
 * Nearly, within `tol` *screen* pixels — which is why the caller divides by
 * the zoom. A tolerance in board units means guides that are impossible to hit
 * when zoomed out and impossible to avoid when zoomed in.
 */
export function guidesFor(
  moving: Rect, others: Rect[], tol = 6,
): { v: number[]; h: number[] } {
  const v: number[] = [], h: number[] = [];
  const mx = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const my = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  for (const o of others) {
    for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) {
      if (mx.some((m) => Math.abs(m - ox) <= tol)) v.push(ox);
    }
    for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) {
      if (my.some((m) => Math.abs(m - oy) <= tol)) h.push(oy);
    }
  }
  return { v: [...new Set(v)], h: [...new Set(h)] };
}

/* ── edges, frames and live nodes ─────────────────────────────────────── */

/**
 * How far a point is from a line segment.
 *
 * For clicking an arrow. Distance to the infinite line is the tempting
 * version and it is wrong: it selects an arrow from anywhere along its
 * extension, so clicking empty canvas half a screen away picks an edge you
 * cannot see. Clamping to the segment is the whole job.
 */
export function distToSegment(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/**
 * Which nodes a frame carries.
 *
 * Containment, not intersection — the opposite of the marquee rule, and
 * deliberately so. A marquee is a gesture you aim; a frame is a container, and
 * one that grabbed every node it merely overlapped would drag its neighbours
 * along every time it moved.
 */
export function nodesInside(frame: Rect, nodes: BoardNode[]): BoardNode[] {
  return nodes.filter(
    (n) =>
      n.x >= frame.x && n.y >= frame.y &&
      n.x + n.w <= frame.x + frame.w &&
      n.y + n.h <= frame.y + frame.h,
  );
}

/** Where an edge's label sits: the midpoint of the drawn segment. */
export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * A curved path between two anchors, bowed along the face each one leaves by.
 *
 * Straight lines between boxes cross each other and cross the boxes, and a
 * diagram of six nodes becomes a cat's cradle. Curving each end *out along
 * its own face* — right leaves rightward, top leaves upward — makes edges
 * separate naturally, and is why every diagramming tool that looks good does
 * this and every one that does not looks like a wiring loom.
 *
 * The bow scales with the distance so short links stay nearly straight,
 * capped so a long one does not swing across the board.
 */
export function edgePath(
  p1: { x: number; y: number; side?: Side },
  p2: { x: number; y: number; side?: Side },
): string {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const bow = Math.min(140, Math.max(20, dist * 0.4));
  const out = (p: { x: number; y: number; side?: Side }, other: { x: number; y: number }) => {
    switch (p.side) {
      case "l": return { x: p.x - bow, y: p.y };
      case "r": return { x: p.x + bow, y: p.y };
      case "t": return { x: p.x, y: p.y - bow };
      case "b": return { x: p.x, y: p.y + bow };
      default: {
        /*
         * A free endpoint has no face to leave by, so it bows toward the other
         * end — a third of the way along, which keeps the curve reading as one
         * gesture.
         *
         * Returning the point itself, as this once did, makes the control
         * point coincide with the endpoint. The tangent there is then
         * undefined, and an arrowhead oriented along it points in an arbitrary
         * direction — which is exactly how it looked: heads aimed at nothing.
         */
        const dx = other.x - p.x, dy = other.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const reach = Math.min(bow, len / 3);
        return { x: p.x + (dx / len) * reach, y: p.y + (dy / len) * reach };
      }
    }
  };
  const c1 = out(p1, p2);
  const c2 = out(p2, p1);
  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
}

/**
 * Smooth a polyline into quadratic curves through the midpoints.
 *
 * Raw pointer samples drawn as straight segments look like a seismograph at
 * any real zoom — every hand tremor is a visible corner. Running the curve
 * through the midpoint of each pair, with the sample itself as the control
 * point, is the standard trick: it costs nothing, needs no extra points, and
 * turns the same data into a line that looks drawn rather than plotted.
 */
export function inkPath(pts: number[]): string {
  const n = pts.length / 2;
  if (n < 2) return "";
  if (n === 2) return `M ${pts[0]} ${pts[1]} L ${pts[2]} ${pts[3]}`;

  let d = `M ${pts[0]} ${pts[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const cx = pts[i * 2], cy = pts[i * 2 + 1];
    const mx = (cx + pts[i * 2 + 2]) / 2;
    const my = (cy + pts[i * 2 + 3]) / 2;
    d += ` Q ${cx} ${cy}, ${mx} ${my}`;
  }
  // The final sample is a control point for nothing, so it is drawn to.
  d += ` L ${pts[(n - 1) * 2]} ${pts[(n - 1) * 2 + 1]}`;
  return d;
}

/**
 * Node text search.
 *
 * Case-insensitive across everything a node can be identified by — its text
 * and, for attachments, the filename. Returns ids in document order so
 * stepping through hits with Enter is stable rather than jumping around.
 */
export function searchNodes(nodes: BoardNode[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    .filter((n) => `${n.text ?? ""} ${n.file?.name ?? ""}`.toLowerCase().includes(q))
    .map((n) => n.id);
}

/** The sources a live node can be bound to. */
export const LIVE_SOURCES = ["tasks", "markets", "health", "calendar", "career"] as const;
export type LiveSource = (typeof LIVE_SOURCES)[number];
