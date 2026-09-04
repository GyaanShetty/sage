import { type BoardDoc, type BoardNode, type Tone, centreOf, contentBounds } from "@/core/board/types";

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
  for (const s of doc.strokes) {
    if (s.pts.length < 4) continue;
    ctx.strokeStyle = TONE_CSS[s.tone ?? "plain"];
    ctx.lineWidth = s.w ?? 2;
    ctx.beginPath();
    ctx.moveTo(s.pts[0], s.pts[1]);
    for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i], s.pts[i + 1]);
    ctx.stroke();
  }

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  for (const e of doc.edges) {
    const a = "node" in e.from ? byId.get(e.from.node) : e.from;
    const b = "node" in e.to ? byId.get(e.to.node) : e.to;
    if (!a || !b) continue;
    const end = (v: BoardNode | { x: number; y: number }) => ("w" in v ? centreOf(v) : v);
    const ac = end(a), bc = end(b);
    ctx.strokeStyle = TONE_CSS[e.tone ?? "plain"];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ac.x, ac.y);
    ctx.lineTo(bc.x, bc.y);
    ctx.stroke();

    // The head, drawn as a filled triangle along the line's own direction.
    const ang = Math.atan2(bc.y - ac.y, bc.x - ac.x);
    ctx.fillStyle = TONE_CSS[e.tone ?? "plain"];
    ctx.beginPath();
    ctx.moveTo(bc.x, bc.y);
    ctx.lineTo(bc.x - 10 * Math.cos(ang - 0.4), bc.y - 10 * Math.sin(ang - 0.4));
    ctx.lineTo(bc.x - 10 * Math.cos(ang + 0.4), bc.y - 10 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
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
