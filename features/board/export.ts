import { type BoardDoc, type BoardNode, type Tone, anchorPoint, centreOf, contentBounds, edgePath, inkPath } from "@/core/board/types";

/**
 * Render a board to a PNG.
 *
 * By walking the document, not by screenshotting the DOM. html2canvas-style
 * capture is resolution-bound — you get exactly what was on screen, cropped to
 * the viewport, at whatever zoom happened to be applied — and it cannot draw
 * what is scrolled out of view. Walking the document means the export is the
 * whole board at whatever scale is asked for, and it needs no library.
 *
 * The one thing it cannot do is images: a file node's bitmap lives behind a
 * signed URL, and drawing it would taint the canvas and make toBlob throw. So
 * image and file nodes export as their frame and label, which is honest — the
 * alternative is an export that silently fails on any board with a photo.
 */

const TONE_CSS: Record<Tone, string> = {
  plain: "#9a9ba1", signal: "#ff3b30", amber: "#ff6b35", cyan: "#35c7ff", green: "#2fd07a",
};
const GROUND = "#08090b";
const PANEL = "#0c0d0f";
const TEXT = "#f4f5f7";

/** Wrap text to a width, so a long note does not run off its own card. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) { out.push(line); line = word; }
      else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function exportPng(doc: BoardDoc, scale = 2): Promise<Blob | null> {
  const r = contentBounds(doc, 40);
  if (!r) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.min(8000, Math.round(r.w * scale));
  canvas.height = Math.min(8000, Math.round(r.h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-r.x, -r.y);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Ink first, so a note dropped over a scribble covers it here exactly as it
  // does on screen.
  // Path2D takes the same SVG path data the canvas renders, so the export is
  // the drawing rather than a straight-segment approximation of it.
  for (const s of doc.strokes) {
    if (s.pts.length < 4) continue;
    ctx.strokeStyle = TONE_CSS[s.tone ?? "plain"];
    ctx.lineWidth = s.w ?? 2;
    ctx.stroke(new Path2D(inkPath(s.pts)));
  }

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  for (const e of doc.edges) {
    const a = "node" in e.from ? byId.get(e.from.node) : e.from;
    const b = "node" in e.to ? byId.get(e.to.node) : e.to;
    if (!a || !b) continue;
    const isNode = (v: BoardNode | { x: number; y: number }): v is BoardNode => "w" in v;
    const ac = isNode(a) ? centreOf(a) : a;
    const bc = isNode(b) ? centreOf(b) : b;
    const p1 = isNode(a) ? anchorPoint(a, bc) : { ...ac, side: undefined };
    const p2 = isNode(b) ? anchorPoint(b, ac) : { ...bc, side: undefined };

    ctx.strokeStyle = TONE_CSS[e.tone ?? "plain"];
    ctx.lineWidth = 1.5;
    ctx.stroke(new Path2D(edgePath(p1, p2)));

    /*
     * The head points along the curve, not along the chord.
     *
     * On a bowed edge those differ by enough to look broken — an arrowhead
     * aimed at the far box while the line arrives from the side. The tangent
     * at the end of a cubic runs from its last control point to its endpoint,
     * and the control point sits along the anchor's own face.
     */
    const bow = Math.min(140, Math.max(20, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.4));
    const c2 =
      p2.side === "l" ? { x: p2.x - bow, y: p2.y }
      : p2.side === "r" ? { x: p2.x + bow, y: p2.y }
      : p2.side === "t" ? { x: p2.x, y: p2.y - bow }
      : p2.side === "b" ? { x: p2.x, y: p2.y + bow }
      // Free endpoint: the control bows back toward the start, matching
      // edgePath, so the exported head points the same way the screen does.
      : p1;
    const ang = Math.atan2(p2.y - c2.y, p2.x - c2.x);
    ctx.fillStyle = TONE_CSS[e.tone ?? "plain"];
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - 10 * Math.cos(ang - 0.4), p2.y - 10 * Math.sin(ang - 0.4));
    ctx.lineTo(p2.x - 10 * Math.cos(ang + 0.4), p2.y - 10 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();

    if (e.label) {
      const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      ctx.font = "11px ui-monospace, Menlo, monospace";
      const w = ctx.measureText(e.label).width + 12;
      ctx.fillStyle = GROUND;
      ctx.fillRect(m.x - w / 2, m.y - 9, w, 18);
      ctx.strokeRect(m.x - w / 2, m.y - 9, w, 18);
      ctx.fillStyle = TEXT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(e.label, m.x, m.y);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
    }
  }

  for (const n of doc.nodes) {
    const tint = TONE_CSS[n.tone ?? "plain"];
    const solid = n.kind !== "rect" && n.kind !== "ellipse";

    ctx.strokeStyle = tint;
    ctx.lineWidth = 1;
    if (n.kind === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(n.x + n.w / 2, n.y + n.h / 2, n.w / 2, n.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      if (solid) { ctx.fillStyle = PANEL; ctx.fillRect(n.x, n.y, n.w, n.h); }
      ctx.strokeRect(n.x, n.y, n.w, n.h);
    }

    ctx.fillStyle = TEXT;
    ctx.font = "13px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "top";
    const label = n.kind === "file" || n.kind === "image" ? (n.file?.name ?? n.kind) : (n.text ?? "");
    if (!label) continue;

    const centred = n.kind === "rect" || n.kind === "ellipse";
    const lines = wrap(ctx, label, n.w - 16).slice(0, Math.max(1, Math.floor((n.h - 12) / 17)));
    lines.forEach((line, i) => {
      const y = centred ? n.y + n.h / 2 - (lines.length * 17) / 2 + i * 17 : n.y + 8 + i * 17;
      if (centred) {
        ctx.textAlign = "center";
        ctx.fillText(line, n.x + n.w / 2, y);
        ctx.textAlign = "left";
      } else {
        ctx.fillText(line, n.x + 8, y);
      }
    });
  }

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
