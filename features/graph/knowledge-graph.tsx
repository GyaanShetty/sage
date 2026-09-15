"use client";

import { useEffect, useRef, useState } from "react";
import "@/features/dashboard/command.css";

interface GNode { id: string; label: string; kind: string; group: string; weight: number }
interface GEdge { a: string; b: string }
interface Sim extends GNode { x: number; y: number; vx: number; vy: number }

/** A stable small integer from a node id — same graph shape every reload. */
function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

const COLOR: Record<string, string> = { memory: "#f4f5f7", note: "#e8e9ec", source: "#ff3b30" };

export function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0, disposed = false;
    let nodes: Sim[] = [];
    let edges: { a: Sim; b: Sim }[] = [];
    let pending: GNode[] | null = null;      // data awaiting a valid canvas size
    let pendingEdges: GEdge[] = [];
    let seeded = false;
    const prevPos = new Map<string, { x: number; y: number }>();
    let W = 0, H = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let drag: Sim | null = null;
    const mouse = { x: 0, y: 0, down: false };

    const size = () => {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      // Ignore zero-size layout passes — sizing the backing store to 0 blanks
      // the canvas (the "white screen") and makes the centering target (0,0),
      // which yanks every node into the corner.
      if (cw <= 0 || ch <= 0) return;
      W = cw; H = ch;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(canvas);

    // Seed node positions around the LIVE centre once we actually have size.
    const seed = () => {
      if (seeded || !pending || W <= 0 || H <= 0) return;
      const gn = pending;
      const byId = new Map<string, Sim>();
      const cx = W / 2, cy = H / 2;
      const R = Math.min(cx, cy) * 0.8;
      nodes = gn.map((n, i) => {
        const ang = (i / gn.length) * Math.PI * 2;
        // Reuse a prior position if this node already existed, so live updates
        // grow the graph smoothly instead of reshuffling everything.
        const prev = prevPos.get(n.id);
        /*
         * Jitter, or the ring never breaks.
         *
         * Nodes were seeded on a perfect circle and every force here is
         * symmetric — equal repulsion between equal neighbours, a centre pull
         * that is the same in all directions. A symmetric arrangement under
         * symmetric forces stays symmetric forever, so the simulation ran and
         * the layout never moved: a ring of dots, which reads as a force
         * layout that failed to start.
         *
         * The offset is derived from the node's id rather than Math.random,
         * so the graph settles into the same shape on every reload instead of
         * rearranging itself each time you open the page.
         */
        const h = hashOf(n.id);
        const jx = ((h % 1000) / 1000 - 0.5) * R * 0.55;
        const jy = (((h >> 10) % 1000) / 1000 - 0.5) * R * 0.55;

        const s: Sim = prev
          ? { ...n, x: prev.x, y: prev.y, vx: 0, vy: 0 }
          : { ...n, x: cx + Math.cos(ang) * R + jx, y: cy + Math.sin(ang) * R + jy, vx: 0, vy: 0 };
        byId.set(n.id, s); return s;
      });
      edges = pendingEdges
        .map((e) => ({ a: byId.get(e.a), b: byId.get(e.b) }))
        .filter((e): e is { a: Sim; b: Sim } => !!e.a && !!e.b);
      seeded = true;
    };

    let sig = "";
    const load = () => {
      fetch("/api/graph", { cache: "no-store" }).then((r) => r.json()).then((j) => {
        if (disposed) return;
        const gn: GNode[] = j?.data?.nodes ?? [];
        if (!gn.length) { setEmpty(true); return; }
        const ge: GEdge[] = Array.isArray(j?.data?.edges) ? (j.data.edges as GEdge[]) : [];

        // The signature decides whether anything changed, so it has to cover
        // everything that is drawn. It used to be node IDs alone, which meant
        // editing a memory, retitling a note, or forming a new connection all
        // produced an identical signature and the graph quietly refused to
        // update — the ids had not changed, only everything about them.
        const nextSig = [
          gn.map((n) => `${n.id}:${n.label}:${n.group}:${n.weight}`).sort().join("|"),
          ge.map((e) => `${e.a}>${e.b}`).sort().join("|"),
        ].join("#");
        if (nextSig === sig) return; // genuinely nothing new — leave the sim alone
        sig = nextSig;
        setEmpty(false);
        // Remember current positions so unchanged nodes stay put.
        prevPos.clear();
        for (const n of nodes) prevPos.set(n.id, { x: n.x, y: n.y });
        pending = gn;
        pendingEdges = ge;
        seeded = false; // let the loop re-seed with the new set
        seed();
      }).catch(() => { if (!nodes.length) setEmpty(true); });
    };
    load();

    // Live refresh: poll, on tab focus, and whenever memory changes elsewhere.
    const poll = window.setInterval(load, 30000);
    const onFocus = () => load();
    const onMem = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("sage:memory-updated", onMem);

    const step = () => {
      // repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy || 0.01;
          const f = 1400 / d2;
          const d = Math.sqrt(d2);
          dx /= d; dy /= d;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
      }
      // spring along edges
      for (const e of edges) {
        let dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = (d - 90) * 0.008;
        dx /= d; dy /= d;
        e.a.vx += dx * f; e.a.vy += dy * f; e.b.vx -= dx * f; e.b.vy -= dy * f;
      }
      // centering + integrate (guard against NaN blowups)
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.006;
        n.vy += (H / 2 - n.y) * 0.006;
        n.vx = Number.isFinite(n.vx) ? n.vx * 0.86 : 0;
        n.vy = Number.isFinite(n.vy) ? n.vy * 0.86 : 0;
        if (n !== drag) { n.x += n.vx; n.y += n.vy; }
        if (!Number.isFinite(n.x)) n.x = W / 2;
        if (!Number.isFinite(n.y)) n.y = H / 2;
      }
      if (drag) { drag.x = mouse.x; drag.y = mouse.y; }
    };

    const draw = () => {
      if (W <= 0 || H <= 0) return; // nothing to paint until we have real size
      // solid dark fill so the canvas is never transparent-white
      ctx.fillStyle = "#08090b";
      ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1;
      for (const e of edges) {
        ctx.strokeStyle = "rgba(255, 255, 255,0.12)";
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
      }
      let hov: GNode | null = null;
      for (const n of nodes) {
        const r = 3 + n.weight * 2.2;
        const near = Math.hypot(n.x - mouse.x, n.y - mouse.y) < r + 6;
        if (near) hov = n;
        const col = COLOR[n.kind] ?? "#9a9a9f";
        ctx.beginPath(); ctx.arc(n.x, n.y, r + (near ? 3 : 0), 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.globalAlpha = near ? 1 : 0.85; ctx.fill();
        ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        ctx.globalAlpha = 1;
        /*
         * Labels, on a graph small enough to read.
         *
         * The rule was `near || weight > 1.6`, and almost nothing reaches
         * 1.6 — so a graph of thirty nodes drew thirty unlabelled dots and
         * you had to hover each one to learn what it was. A mind map whose
         * nodes are anonymous is a screensaver.
         *
         * Above sixty nodes the labels would overlap into mush, so there the
         * old weight gate still applies and hovering is the way in.
         */
        const labelled = near || nodes.length <= 60 || n.weight > 1.6;
        if (labelled) {
          ctx.font = "10px 'JetBrains Mono', monospace";
          ctx.fillStyle = near ? "#eef2f2" : `rgba(238,242,242,${Math.min(0.78, 0.4 + n.weight * 0.2)})`;
          ctx.textAlign = "center";
          ctx.fillText(n.label.slice(0, near ? 40 : 18), n.x, n.y - r - 6);
        }
      }
      if (hov !== hover) setHover(hov);
      canvas.style.cursor = hov ? "pointer" : "grab";
    };

    const loop = () => {
      if (W <= 0 || H <= 0) size(); // retry sizing until layout gives real dims
      if (!seeded) seed();          // data may have arrived before a valid size
      step();
      draw();
      raf = requestAnimationFrame(loop);
    };
    loop();

    const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    const onDown = (e: PointerEvent) => { pos(e); mouse.down = true; drag = nodes.find((n) => Math.hypot(n.x - mouse.x, n.y - mouse.y) < 3 + n.weight * 2.2 + 6) ?? null; };
    const onMove = (e: PointerEvent) => pos(e);
    const onUp = () => { mouse.down = false; drag = null; };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect();
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("sage:memory-updated", onMem);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stage">
      <div className="stage-hud">
        <div className="sectitle" style={{ marginBottom: 4 }}><span className="sn">KG</span><h2>Mind Graph</h2><span className="line" /><span className="tag">MEMORIES · NOTES · KNOWLEDGE</span></div>
        <div className="kg-legend">
          <span><i style={{ background: COLOR.memory }} /> MEMORY</span>
          <span><i style={{ background: COLOR.note }} /> NOTE</span>
          <span><i style={{ background: COLOR.source }} /> SOURCE</span>
        </div>
      </div>
      <canvas ref={canvasRef} className="stage-stage" style={{ background: "#08090b", display: "block", width: "100%", height: "100%" }} />
      {empty && <div className="stage-nomodel">NO MEMORIES YET — TALK TO SAGE AND INGEST KNOWLEDGE TO GROW YOUR GRAPH</div>}
      {hover && (
        <div className="kg-tip">
          <div className="kg-kind" style={{ color: COLOR[hover.kind] }}>{hover.kind.toUpperCase()} · {hover.group}</div>
          <div className="kg-label">{hover.label}</div>
        </div>
      )}
    </div>
  );
}
