"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BoardDoc, type BoardNode, type Edge, type Tone,
  anchorPoint, centreOf, screenToBoard, simplify, strokeNear,
} from "@/core/board/types";
import "./board.css";

/**
 * The board.
 *
 * Two rendering layers sharing one transform, which is the decision the rest
 * of the file follows from:
 *
 * - **Nodes are real DOM.** A sticky note has to be typed into and a file card
 *   clicked. Drawing text on a canvas means reimplementing selection, the
 *   caret, IME and copy/paste, which is where hand-rolled whiteboards die.
 * - **Arrows and ink are one SVG overlay** in the same coordinate space, so an
 *   arrow stays attached to a node that is being dragged without either layer
 *   knowing about the other.
 *
 * Saving is debounced and never blocks a gesture: local state moves first, the
 * network catches up. The version field is the guard — a save that would
 * overwrite a newer document is refused by the API and surfaced here rather
 * than silently winning.
 */

type Tool = "select" | "pan" | "sticky" | "text" | "pen" | "eraser" | "arrow";

const TONES: { id: Tone; css: string }[] = [
  { id: "plain", css: "#9a9ba1" },
  { id: "signal", css: "#ff3b30" },
  { id: "amber", css: "#ff6b35" },
  { id: "cyan", css: "#35c7ff" },
  { id: "green", css: "#2fd07a" },
];
const TONE_CSS: Record<Tone, string> = {
  plain: "#9a9ba1", signal: "#ff3b30", amber: "#ff6b35", cyan: "#35c7ff", green: "#2fd07a",
};

const MIN_K = 0.1;
const MAX_K = 4;
const SAVE_DEBOUNCE = 800;
/** Simplification tolerance, in board units at zoom 1. */
const INK_EPSILON = 0.8;

const uid = () => crypto.randomUUID();

export function BoardCanvas({ initial }: { initial: BoardDoc }) {
  const [doc, setDoc] = useState<BoardDoc>(initial);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [tone, setTone] = useState<Tone>("plain");
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  /** The stroke currently under the pen, kept out of `doc` so a live drawing
   *  does not trigger the autosave on every pointer move. */
  const [ink, setInk] = useState<number[] | null>(null);
  /** An arrow being dragged: its origin node and current free end. */
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null);

  /* ── saving ───────────────────────────────────────────────────────────
     The document is the unit of saving, so every mutation goes through
     `mutate`, which stamps the change and lets the debounce below carry it. */

  const dirty = useRef(false);
  const docRef = useRef(doc);
  docRef.current = doc;

  const mutate = useCallback((f: (d: BoardDoc) => BoardDoc) => {
    dirty.current = true;
    setDoc((d) => f(d));
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      dirty.current = false;
      setStatus("saving");
      try {
        const res = await fetch(`/api/board/${docRef.current.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(docRef.current),
        });
        const j = await res.json().catch(() => null);
        if (res.ok && j?.ok) {
          // Take the server's version back, or the next save conflicts with
          // the one we just made.
          setDoc((d) => ({ ...d, version: j.data.version, updatedAt: j.data.updatedAt }));
          setStatus("saved");
          setNote(null);
        } else {
          setStatus("error");
          setNote(j?.error ?? `Save failed (${res.status}).`);
        }
      } catch {
        setStatus("error");
        setNote("Offline — changes are still on screen but not saved.");
      }
    }, SAVE_DEBOUNCE);
    return () => clearTimeout(t);
  }, [doc]);

  // A board with unsaved edits should say so before the tab closes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  /* ── view ─────────────────────────────────────────────────────────────── */

  const toBoard = useCallback((e: { clientX: number; clientY: number }) => {
    const r = hostRef.current?.getBoundingClientRect();
    return screenToBoard(e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0), view);
  }, [view]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    /*
     * Wheel is bound here rather than as a React prop because it must be
     * non-passive to preventDefault, and React attaches wheel listeners
     * passively — without which the browser zooms the whole page on a pinch
     * and the board scrolls away underneath it.
     */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = host.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      setView((v) => {
        // ctrl/⌘ + wheel is a pinch on a trackpad; a plain wheel pans, which
        // is what every canvas app does and what the hand expects.
        if (e.ctrlKey || e.metaKey) {
          const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY / 400)));
          // Keep the point under the cursor fixed: without this the board
          // slides away from whatever you were zooming into.
          return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
        }
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      });
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, []);

  /* ── pointer ──────────────────────────────────────────────────────────── */

  const gesture = useRef<
    | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
    | { kind: "move"; id: string; dx: number; dy: number }
    | { kind: "resize"; id: string; ox: number; oy: number; w: number; h: number }
    | null
  >(null);

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 1 || tool === "pan" || (e.button === 0 && e.altKey)) {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const p = toBoard(e);

    if (tool === "pen") { setInk([p.x, p.y]); (e.target as Element).setPointerCapture?.(e.pointerId); return; }
    if (tool === "eraser") { erase(p.x, p.y); (e.target as Element).setPointerCapture?.(e.pointerId); return; }
    if (tool === "sticky" || tool === "text") { addNode(tool, p.x, p.y); return; }

    // Empty space with the select tool: clear the selection rather than
    // leaving a node highlighted while you work somewhere else.
    if (e.target === hostRef.current || (e.target as HTMLElement).classList.contains("bd-grid")) {
      setSel(null); setEditing(null);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g?.kind === "pan") {
      setView((v) => ({ ...v, x: g.vx + (e.clientX - g.sx), y: g.vy + (e.clientY - g.sy) }));
      return;
    }
    const p = toBoard(e);
    if (g?.kind === "move") {
      mutate((d) => ({
        ...d,
        nodes: d.nodes.map((n) => (n.id === g.id ? { ...n, x: p.x - g.dx, y: p.y - g.dy } : n)),
      }));
      return;
    }
    if (g?.kind === "resize") {
      mutate((d) => ({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === g.id
            ? { ...n, w: Math.max(60, g.w + (p.x - g.ox)), h: Math.max(40, g.h + (p.y - g.oy)) }
            : n),
      }));
      return;
    }
    if (ink) { setInk((s) => (s ? [...s, p.x, p.y] : s)); return; }
    if (tool === "eraser" && e.buttons === 1) { erase(p.x, p.y); return; }
    if (wire) { setWire({ ...wire, x: p.x, y: p.y }); return; }
  };

  const onUp = (e: React.PointerEvent) => {
    gesture.current = null;

    if (ink) {
      // Simplify on commit, not while drawing: simplifying live makes the line
      // visibly twitch behind the pen as points are dropped and re-added.
      const pts = simplify(ink, INK_EPSILON / view.k);
      if (pts.length >= 4) {
        mutate((d) => ({ ...d, strokes: [...d.strokes, { id: uid(), pts, tone, w: 2 }] }));
      }
      setInk(null);
      return;
    }

    if (wire) {
      const p = toBoard(e);
      const hit = docRef.current.nodes.find(
        (n) => p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h && n.id !== wire.from,
      );
      // An arrow to empty space is a legitimate diagram, so a miss makes a
      // free endpoint rather than throwing the gesture away.
      const to = hit ? { node: hit.id } : { x: p.x, y: p.y };
      mutate((d) => ({ ...d, edges: [...d.edges, { id: uid(), from: { node: wire.from }, to, tone }] }));
      setWire(null);
    }
  };

  /* ── mutations ────────────────────────────────────────────────────────── */

  const addNode = (kind: "sticky" | "text", x: number, y: number) => {
    const n: BoardNode = {
      id: uid(), kind,
      x: Math.round(x), y: Math.round(y),
      w: kind === "sticky" ? 180 : 240,
      h: kind === "sticky" ? 130 : 90,
      text: "", tone,
    };
    mutate((d) => ({ ...d, nodes: [...d.nodes, n] }));
    setSel(n.id);
    setEditing(n.id);
    setTool("select");
  };

  const erase = (x: number, y: number) => {
    const r = 10 / view.k;
    const doomed = new Set(docRef.current.strokes.filter((s) => strokeNear(s, x, y, r)).map((s) => s.id));
    if (!doomed.size) return;
    mutate((d) => ({ ...d, strokes: d.strokes.filter((s) => !doomed.has(s.id)) }));
  };

  const removeNode = (id: string) => {
    mutate((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== id),
      // An edge whose node is gone would render to a stale anchor forever.
      edges: d.edges.filter((e) => !("node" in e.from && e.from.node === id) && !("node" in e.to && e.to.node === id)),
    }));
    setSel(null);
    setEditing(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
      /*
       * And not while a node is open for editing, even if focus has slipped
       * off the textarea for a frame. Otherwise typing a note runs the
       * single-key tool shortcuts underneath it — "Interview prep" contains an
       * n, which silently switches to the sticky tool and drops a new node on
       * the next click.
       */
      if (editing) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); removeNode(sel); return; }
      if (e.key === "Escape") { setSel(null); setEditing(null); setTool("select"); return; }
      const keys: Record<string, Tool> = { v: "select", h: "pan", n: "sticky", t: "text", p: "pen", e: "eraser", a: "arrow" };
      if (keys[e.key.toLowerCase()] && !e.metaKey && !e.ctrlKey) setTool(keys[e.key.toLowerCase()]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, editing]);

  /* ── files ────────────────────────────────────────────────────────────── */

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    const p = toBoard(e);

    for (const [i, file] of files.entries()) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/files", { method: "POST", body: fd });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) { setNote(j?.error ?? `Could not upload ${file.name}.`); continue; }
        /*
         * /api/files deliberately strips the extracted body from its response
         * — it can be 40,000 characters — and returns `readable` and `chars`
         * instead. So the card reports whether SAGE can read the file rather
         * than showing a preview, because a preview field that is always
         * undefined would render as a permanently empty box that looks broken.
         */
        const f = j.data as { name: string; path: string; mime: string; size: number; readable?: boolean; chars?: number };
        const isImage = f.mime.startsWith("image/");
        mutate((d) => ({
          ...d,
          nodes: [...d.nodes, {
            id: uid(),
            kind: isImage ? "image" : "file",
            x: Math.round(p.x + i * 24), y: Math.round(p.y + i * 24),
            w: isImage ? 260 : 220, h: isImage ? 200 : 150,
            tone,
            file: { name: f.name, path: f.path, mime: f.mime, size: f.size, readable: !!f.readable, chars: f.chars ?? 0 },
          }],
        }));
      } catch {
        setNote(`Could not upload ${file.name}.`);
      }
    }
  };

  /* ── render ───────────────────────────────────────────────────────────── */

  const byId = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes]);

  /** Both ends of an edge, resolved to points on the boxes they connect. */
  const edgeGeom = (e: Edge) => {
    const a = "node" in e.from ? byId.get(e.from.node) : null;
    const b = "node" in e.to ? byId.get(e.to.node) : null;
    if ("node" in e.from && !a) return null;   // node deleted mid-flight
    if ("node" in e.to && !b) return null;

    const bPoint = b ? centreOf(b) : (e.to as { x: number; y: number });
    const aPoint = a ? centreOf(a) : (e.from as { x: number; y: number });
    const p1 = a ? anchorPoint(a, bPoint) : aPoint;
    const p2 = b ? anchorPoint(b, aPoint) : bPoint;
    return { p1, p2 };
  };

  const grid = {
    backgroundSize: `${24 * view.k}px ${24 * view.k}px, ${24 * view.k}px ${24 * view.k}px, ${240 * view.k}px ${240 * view.k}px, ${240 * view.k}px ${240 * view.k}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

  return (
    <div
      ref={hostRef}
      className={`bd${tool === "pan" ? " is-pan" : ""}${tool === "pen" ? " is-ink" : ""}${tool === "eraser" ? " is-erase" : ""}${tool === "sticky" || tool === "text" ? " is-place" : ""}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="bd-grid" style={grid} />

      <svg className="bd-svg" width="100%" height="100%">
        <defs>
          {TONES.map((t) => (
            <marker key={t.id} id={`bd-ah-${t.id}`} viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={t.css} />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {doc.strokes.map((s) => (
            <path key={s.id} d={pathOf(s.pts)} fill="none"
              stroke={TONE_CSS[s.tone ?? "plain"]} strokeWidth={(s.w ?? 2) / view.k * view.k}
              strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {ink && (
            <path d={pathOf(ink)} fill="none" stroke={TONE_CSS[tone]} strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
          )}
          {doc.edges.map((e) => {
            const g = edgeGeom(e);
            if (!g) return null;
            const c = TONE_CSS[e.tone ?? "plain"];
            return (
              <line key={e.id} x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y}
                stroke={c} strokeWidth={1.5} markerEnd={`url(#bd-ah-${e.tone ?? "plain"})`} />
            );
          })}
          {wire && byId.get(wire.from) && (
            <line
              x1={anchorPoint(byId.get(wire.from)!, wire).x}
              y1={anchorPoint(byId.get(wire.from)!, wire).y}
              x2={wire.x} y2={wire.y}
              stroke={TONE_CSS[tone]} strokeWidth={1.5} strokeDasharray="4 3"
            />
          )}
        </g>
      </svg>

      <div className="bd-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        {doc.nodes.map((n) => (
          <NodeView
            key={n.id}
            n={n}
            selected={sel === n.id}
            editing={editing === n.id}
            onSelect={() => { setSel(n.id); }}
            onEdit={() => setEditing(n.id)}
            onBlur={() => { if (editing === n.id) setEditing(null); }}
            onText={(text) => mutate((d) => ({ ...d, nodes: d.nodes.map((m) => (m.id === n.id ? { ...m, text } : m)) }))}
            onRemove={() => removeNode(n.id)}
            onDragStart={(e) => {
              const p = toBoard(e);
              gesture.current = { kind: "move", id: n.id, dx: p.x - n.x, dy: p.y - n.y };
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }}
            onResizeStart={(e) => {
              const p = toBoard(e);
              gesture.current = { kind: "resize", id: n.id, ox: p.x, oy: p.y, w: n.w, h: n.h };
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }}
            onWireStart={(e) => {
              const p = toBoard(e);
              setWire({ from: n.id, x: p.x, y: p.y });
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }}
          />
        ))}
      </div>

      <div className="bd-tools" onPointerDown={(e) => e.stopPropagation()}>
        {([
          ["select", "▷", "Select (V)"], ["pan", "✋", "Pan (H)"], ["sticky", "▤", "Sticky note (N)"],
          ["text", "T", "Text (T)"], ["pen", "✎", "Pen (P)"], ["eraser", "⌫", "Eraser (E)"],
          ["arrow", "→", "Arrow — drag from a node's edge dot (A)"],
        ] as [Tool, string, string][]).map(([id, glyph, label]) => (
          <button key={id} className={tool === id ? "on" : ""} title={label} aria-label={label}
            onClick={() => setTool(id)}>{glyph}</button>
        ))}
      </div>

      <div className="bd-tones" onPointerDown={(e) => e.stopPropagation()}>
        {TONES.map((t) => (
          <button key={t.id} className={tone === t.id ? "on" : ""} title={t.id} aria-label={`Colour ${t.id}`}
            style={{ ["--c" as string]: t.css }} onClick={() => setTone(t.id)} />
        ))}
      </div>

      <div className="bd-hud" onPointerDown={(e) => e.stopPropagation()}>
        <span><b>{doc.nodes.length}</b> nodes</span>
        <span><b>{doc.strokes.length}</b> strokes</span>
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })}>{Math.round(view.k * 100)}%</button>
        <span className={status === "error" ? "sv" : ""}>
          {status === "saving" ? "SAVING" : status === "error" ? "UNSAVED" : "SAVED"}
        </span>
      </div>

      {note && (
        <div className="bd-hud" style={{ right: 8, bottom: 40, color: "var(--signal)" }}
          onPointerDown={(e) => e.stopPropagation()}>
          {note}
          <button onClick={() => setNote(null)}>✕</button>
        </div>
      )}

      {dropping && <div className="bd-drop">DROP TO ATTACH</div>}
    </div>
  );
}

/** An SVG path from the flat point array. */
function pathOf(pts: number[]): string {
  if (pts.length < 4) return "";
  let d = `M ${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
  return d;
}

function NodeView({
  n, selected, editing, onSelect, onEdit, onBlur, onText, onRemove, onDragStart, onResizeStart, onWireStart,
}: {
  n: BoardNode;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onBlur: () => void;
  onText: (t: string) => void;
  onRemove: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onWireStart: (e: React.PointerEvent) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  /*
   * Focus on the frame *after* editing opens, not with autoFocus.
   *
   * A new note is created by a pointerdown, and autoFocus put the caret in the
   * textarea while that same click was still in flight — so the click finished
   * on the canvas, stole focus back, and the blur closed the editor before a
   * single character arrived. Everything typed then fell through to the
   * window-level tool shortcuts.
   */
  useEffect(() => {
    if (!editing) return;
    const id = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [editing]);

  const label = n.kind === "sticky" ? "NOTE" : n.kind === "text" ? "TEXT" : n.kind === "image" ? "IMAGE" : "FILE";

  return (
    <div
      className={`bd-n t-${n.tone ?? "plain"}${selected ? " sel" : ""}`}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={() => { if (n.kind === "sticky" || n.kind === "text") onEdit(); }}
    >
      <header className="bd-n-hd" onPointerDown={(e) => { e.stopPropagation(); onSelect(); onDragStart(e); }}>
        <span>{label}</span>
        <button title="Delete" aria-label="Delete node"
          onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}>✕</button>
      </header>

      <div className="bd-n-body">
        {(n.kind === "sticky" || n.kind === "text") && (
          editing ? (
            <textarea
              ref={taRef}
              value={n.text ?? ""}
              placeholder="Type…"
              onChange={(e) => onText(e.target.value)}
              onBlur={onBlur}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <div style={{ whiteSpace: "pre-wrap" }}>
              {n.text || <span style={{ color: "var(--subtle)" }}>Double-click to write</span>}
            </div>
          )
        )}

        {n.kind === "image" && n.file && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files?path=${encodeURIComponent(n.file.path)}`} alt={n.file.name} draggable={false} />
        )}

        {n.kind === "file" && n.file && (
          <div className="bd-n-file">
            <span className="nm">{n.file.name}</span>
            <span className="mt">{(n.file.size / 1024).toFixed(0)} KB · {n.file.mime || "unknown"}</span>
            <div className="pv">
              {n.file.readable
                ? `SAGE can read this — ${(n.file.chars ?? 0).toLocaleString()} characters indexed.`
                : "Opaque to SAGE: stored and downloadable, but not readable as text."}
            </div>
          </div>
        )}
      </div>

      {/* One port per face, so an arrow can be pulled from the side that
          matches the direction of the thought. */}
      {([["t", "50%", "0"], ["r", "100%", "50%"], ["b", "50%", "100%"], ["l", "0", "50%"]] as const).map(
        ([side, left, top]) => (
          <span key={side} className="bd-port" style={{ left, top }}
            onPointerDown={(e) => { e.stopPropagation(); onWireStart(e); }} />
        ),
      )}

      <span className="bd-rz" onPointerDown={(e) => { e.stopPropagation(); onResizeStart(e); }} />
    </div>
  );
}
