"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BoardDoc, type BoardNode, type Edge, type Tone, type Align, type Rect,
  anchorPoint, centreOf, screenToBoard, simplify, strokeNear,
  snap, intersects, rectBetween, alignNodes, distributeNodes, contentBounds, fitView, guidesFor, GRID,
  nodesInside, distToSegment, midpoint, searchNodes,
} from "@/core/board/types";
import { type History, emptyHistory, record, undo as undoStep, redo as redoStep } from "./history";
import { exportPng } from "./export";
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

type Tool = "select" | "pan" | "sticky" | "text" | "rect" | "ellipse" | "frame" | "pen" | "eraser" | "arrow";

/**
 * Pen weights.
 *
 * Three, not a slider. A slider on a drawing tool is a decision you make every
 * time you pick up the pen; three weights are a decision you make once.
 */
const PEN_SIZES = [2, 5, 10] as const;

/** Text sizes, for the text tool. Same reasoning as the pen. */
const TEXT_SIZES = [14, 22, 34] as const;

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
  /** A set, because everything below acts on a selection rather than a node. */
  const [sel, setSel] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [snapping, setSnapping] = useState(true);
  const [penW, setPenW] = useState<number>(PEN_SIZES[0]);
  const [fontSize, setFontSize] = useState<number>(TEXT_SIZES[0]);
  /** Right-click menu: the fastest way to delete, which is what he asked for. */
  const [menu, setMenu] = useState<{ x: number; y: number; node?: string; edge?: string } | null>(null);
  /** The node an in-flight arrow would connect to, so the target lights up
   *  before you let go rather than after. */
  const [wireTarget, setWireTarget] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [find, setFind] = useState<string>("");
  const [findOpen, setFindOpen] = useState(false);
  const [findAt, setFindAt] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const hist = useRef<History>(emptyHistory());
  /** Clipboard lives in the page, not the OS: an internal copy keeps ids,
   *  sizes, tones and edges, which a text clipboard cannot carry. */
  const clip = useRef<{ nodes: BoardNode[]; edges: Edge[] } | null>(null);
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
  const selRef = useRef(sel);
  selRef.current = sel;

  /**
   * Every change goes through here, which is what makes undo total: there is
   * no path that edits the document without the previous state being recorded
   * first. `kind` is what lets a drag collapse into one undo entry instead of
   * forty.
   */
  const mutate = useCallback((f: (d: BoardDoc) => BoardDoc, kind = "edit") => {
    dirty.current = true;
    setDoc((d) => {
      hist.current = record(hist.current, d, kind);
      return f(d);
    });
  }, []);

  const undo = useCallback(() => {
    const r = undoStep(hist.current, docRef.current);
    if (!r) return;
    hist.current = r.history;
    dirty.current = true;
    setDoc(r.doc);
    setSel([]);
    setEditing(null);
  }, []);

  const redo = useCallback(() => {
    const r = redoStep(hist.current, docRef.current);
    if (!r) return;
    hist.current = r.history;
    dirty.current = true;
    setDoc(r.doc);
    setSel([]);
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
    /** Moves the whole selection, not one node — `origin` holds where each
     *  started so the group keeps its shape however the pointer wanders. */
    | { kind: "move"; origin: Map<string, { x: number; y: number }>; dx: number; dy: number }
    | { kind: "resize"; id: string; ox: number; oy: number; w: number; h: number }
    | { kind: "marquee"; x0: number; y0: number; add: boolean }
    | null
  >(null);

  /**
   * Live pointers, for pinch.
   *
   * Touch is not an afterthought here — it is the device he actually carries.
   * A board that can only be zoomed with a scroll wheel does not exist on a
   * phone, which is why this tracks every pointer rather than assuming one.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; cx: number; cy: number; view: typeof view } | null>(null);

  const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  /*
   * Pointer bookkeeping runs in the capture phase, on the way *down* the tree.
   *
   * Nodes stop propagation on pointerdown so that grabbing a note does not
   * also start a marquee — which meant a second finger landing on a note was
   * invisible to the canvas, and pinch-zoom silently stopped working the
   * moment the board had anything on it. On a phone that is most of the time.
   * Capture runs before any child can stop the event, so the count is always
   * right.
   */
  const onDownCapture = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers down: a pinch, whatever tool is selected and whatever they
    // landed on. Anything in progress is abandoned — a stroke begun with one
    // finger and continued into a two-finger zoom is never what was meant.
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: dist2(a, b), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view };
      gesture.current = null;
      setInk(null);
      setMarquee(null);
    }
  };

  const onMoveCapture = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  };

  const onUpCapture = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onDown = (e: React.PointerEvent) => {
    // The capture handler above already armed the pinch; this one just stays
    // out of the way while two fingers are down.
    if (pointers.current.size >= 2) return;

    /*
     * Palm rejection. A resting palm reports as a touch pointer with a contact
     * patch tens of times larger than a fingertip, so inking ignores it —
     * without which writing with an Apple Pencil paints a stripe wherever the
     * hand rests.
     */
    const palm = e.pointerType === "touch" && (e.width > 45 || e.height > 45);
    if (palm) return;

    if (e.button === 1 || tool === "pan" || (e.button === 0 && e.altKey && tool === "select")) {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const p = toBoard(e);

    if (tool === "pen") { setInk([p.x, p.y]); (e.target as Element).setPointerCapture?.(e.pointerId); return; }
    if (tool === "eraser") { erase(p.x, p.y); (e.target as Element).setPointerCapture?.(e.pointerId); return; }
    if (tool === "sticky" || tool === "text" || tool === "rect" || tool === "ellipse") {
      addNode(tool, p.x, p.y);
      return;
    }

    // Empty canvas with the select tool starts a marquee. Shift adds to the
    // selection rather than replacing it.
    const onEmpty = e.target === hostRef.current || (e.target as HTMLElement).classList.contains("bd-grid");
    if (onEmpty) {
      // An arrow is a line one pixel wide and cannot be clicked as a shape, so
      // "empty canvas" is checked against the edges before it is believed.
      const hitEdge = edgeAt(p.x, p.y, 8 / view.k)[0];
      if (hitEdge && tool === "select") {
        setSelEdge(hitEdge.id);
        setSel([]);
        return;
      }
      setSelEdge(null);
      gesture.current = { kind: "marquee", x0: p.x, y0: p.y, add: e.shiftKey };
      if (!e.shiftKey) { setSel([]); setEditing(null); }
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    // Pinch: scale about the midpoint between the fingers and pan by however
    // far that midpoint has travelled, so zooming and moving are one gesture
    // the way they are on every map.
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const start = pinch.current;
      const r = hostRef.current?.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - (r?.left ?? 0);
      const cy = (a.y + b.y) / 2 - (r?.top ?? 0);
      const k = Math.min(MAX_K, Math.max(MIN_K, start.view.k * (dist2(a, b) / (start.dist || 1))));
      const sx = start.cx - (r?.left ?? 0);
      const sy = start.cy - (r?.top ?? 0);
      setView({
        k,
        x: cx - ((sx - start.view.x) / start.view.k) * k,
        y: cy - ((sy - start.view.y) / start.view.k) * k,
      });
      return;
    }

    const g = gesture.current;
    if (g?.kind === "pan") {
      setView((v) => ({ ...v, x: g.vx + (e.clientX - g.sx), y: g.vy + (e.clientY - g.sy) }));
      return;
    }
    const p = toBoard(e);

    if (g?.kind === "marquee") {
      const r = rectBetween(g.x0, g.y0, p.x, p.y);
      setMarquee(r);
      const hit = docRef.current.nodes.filter((n) => intersects(r, n)).map((n) => n.id);
      setSel(g.add ? [...new Set([...selRef.current, ...hit])] : hit);
      return;
    }

    if (g?.kind === "move") {
      const on = snapping && !e.altKey;
      const dx = p.x - g.dx, dy = p.y - g.dy;
      const anchor = g.origin.get(selRef.current[0] ?? "");
      // Snap the group by its first node's offset, so members keep their
      // relative positions instead of each collapsing onto the grid.
      const ox = anchor ? snap(dx, on) - dx : 0;
      const oy = anchor ? snap(dy, on) - dy : 0;

      mutate((d) => ({
        ...d,
        nodes: d.nodes.map((n) => {
          const o = g.origin.get(n.id);
          return o ? { ...n, x: o.x + dx + ox, y: o.y + dy + oy } : n;
        }),
      }), "move");

      const first = docRef.current.nodes.find((n) => n.id === selRef.current[0]);
      if (first) {
        const others = docRef.current.nodes.filter((n) => !g.origin.has(n.id));
        setGuides(guidesFor({ x: first.x, y: first.y, w: first.w, h: first.h }, others, 6 / view.k));
      }
      return;
    }

    if (g?.kind === "resize") {
      const on = snapping && !e.altKey;
      mutate((d) => ({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === g.id
            ? { ...n, w: Math.max(60, snap(g.w + (p.x - g.ox), on)), h: Math.max(40, snap(g.h + (p.y - g.oy), on)) }
            : n),
      }), "resize");
      return;
    }

    if (ink) { setInk((s) => (s ? [...s, p.x, p.y] : s)); return; }
    if (tool === "eraser" && e.buttons === 1) { erase(p.x, p.y); return; }
    if (wire) {
      setWire({ ...wire, x: p.x, y: p.y });
      setWireTarget(connectTarget(p.x, p.y, wire.from));
      return;
    }
  };

  const onUp = (e: React.PointerEvent) => {
    gesture.current = null;
    setMarquee(null);
    setGuides({ v: [], h: [] });

    if (ink) {
      // Simplify on commit, not while drawing: simplifying live makes the line
      // visibly twitch behind the pen as points are dropped and re-added.
      const pts = simplify(ink, INK_EPSILON / view.k);
      if (pts.length >= 4) {
        mutate((d) => ({ ...d, strokes: [...d.strokes, { id: uid(), pts, tone, w: penW }] }), "ink");
      }
      setInk(null);
      return;
    }

    if (wire) {
      const p = toBoard(e);
      const hit = connectTarget(p.x, p.y, wire.from);
      // An arrow to empty space is a legitimate diagram, so a miss makes a
      // free endpoint rather than throwing the gesture away.
      const to = hit ? { node: hit } : { x: p.x, y: p.y };
      mutate((d) => ({ ...d, edges: [...d.edges, { id: uid(), from: { node: wire.from }, to, tone }] }), "arrow");
      setWire(null);
      setWireTarget(null);
    }
  };

  /* ── mutations ────────────────────────────────────────────────────────── */

  const SIZE: Record<string, [number, number]> = {
    sticky: [180, 130], text: [240, 48], rect: [200, 130], ellipse: [160, 160],
    frame: [520, 360],
  };

  /**
   * Which node an arrow endpoint should attach to.
   *
   * Not "the node directly under the cursor" — that requires landing inside a
   * box, and drawing an arrow then becomes an aiming exercise. Anything within
   * a slack radius of a node's edge counts, so the arrow attaches when you get
   * close and stays attached when the node later moves. The radius is in
   * screen pixels, so it feels the same at every zoom.
   */
  const connectTarget = useCallback((x: number, y: number, exclude?: string): string | null => {
    // 48px of slack, in screen pixels so it feels the same at every zoom.
    // Tighter than this and you have to aim, which is the thing auto-connect
    // exists to remove; looser and arrows attach to neighbours you were only
    // passing over.
    const slack = 48 / view.k;
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of docRef.current.nodes) {
      if (n.id === exclude) continue;
      // Distance to the box: zero inside it, the gap outside.
      const dx = Math.max(n.x - x, 0, x - (n.x + n.w));
      const dy = Math.max(n.y - y, 0, y - (n.y + n.h));
      const d = Math.hypot(dx, dy);
      if (d <= slack && d < bestD) { bestD = d; best = n.id; }
    }
    return best;
  }, [view.k]);

  const addNode = (kind: BoardNode["kind"], x: number, y: number) => {
    const [w, h] = SIZE[kind] ?? [180, 130];
    const n: BoardNode = {
      id: uid(), kind,
      x: snap(Math.round(x), snapping), y: snap(Math.round(y), snapping),
      w, h, text: "", tone,
      ...(kind === "text" ? { fontSize } : {}),
    };
    mutate((d) => ({ ...d, nodes: [...d.nodes, n] }), `add-${kind}`);
    setSel([n.id]);
    // Shapes are labelled, not written into, so they do not open an editor —
    // a caret blinking in the middle of a rectangle you meant to draw is
    // friction, not a feature.
    if (kind === "sticky" || kind === "text") setEditing(n.id);
    setTool("select");
  };

  const erase = (x: number, y: number) => {
    const r = 10 / view.k;
    const doomed = new Set(docRef.current.strokes.filter((s) => strokeNear(s, x, y, r)).map((s) => s.id));
    if (!doomed.size) return;
    mutate((d) => ({ ...d, strokes: d.strokes.filter((s) => !doomed.has(s.id)) }));
  };

  /** Edges whose drawn segment passes within `tol` of a point. */
  const edgeAt = useCallback((x: number, y: number, tol: number): Edge[] => {
    const byNode = new Map(docRef.current.nodes.map((n) => [n.id, n]));
    return docRef.current.edges.filter((e) => {
      const a: BoardNode | { x: number; y: number } | undefined =
        "node" in e.from ? byNode.get(e.from.node) : e.from;
      const b: BoardNode | { x: number; y: number } | undefined =
        "node" in e.to ? byNode.get(e.to.node) : e.to;
      if (!a || !b) return false;
      const isNode = (v: BoardNode | { x: number; y: number }): v is BoardNode => "w" in v;
      const ac = isNode(a) ? centreOf(a) : a;
      const bc = isNode(b) ? centreOf(b) : b;
      const p1 = isNode(a) ? anchorPoint(a, bc) : ac;
      const p2 = isNode(b) ? anchorPoint(b, ac) : bc;
      return distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= tol;
    });
  }, []);

  const removeEdge = (id: string) => {
    mutate((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== id) }), "delete-edge");
    setSelEdge(null);
  };

  const removeSelection = (ids: string[] = selRef.current) => {
    if (!ids.length) return;
    const gone = new Set(ids);
    mutate((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => !gone.has(n.id)),
      // An edge whose node is gone would render to a stale anchor forever.
      edges: d.edges.filter(
        (e) => !("node" in e.from && gone.has(e.from.node)) && !("node" in e.to && gone.has(e.to.node)),
      ),
    }), "delete");
    setSel([]);
    setEditing(null);
  };

  /* ── clipboard and arranging ──────────────────────────────────────────── */

  const selectedNodes = useCallback(
    () => docRef.current.nodes.filter((n) => selRef.current.includes(n.id)),
    [],
  );

  const copy = useCallback(() => {
    const nodes = selectedNodes();
    if (!nodes.length) return;
    const ids = new Set(nodes.map((n) => n.id));
    // Edges come along only when both ends are inside the selection: an edge
    // with one end left behind would paste as an arrow to nowhere.
    const edges = docRef.current.edges.filter(
      (e) => "node" in e.from && "node" in e.to && ids.has(e.from.node) && ids.has(e.to.node),
    );
    clip.current = { nodes, edges };
  }, [selectedNodes]);

  const paste = useCallback((dx = 24, dy = 24) => {
    const c = clip.current;
    if (!c?.nodes.length) return;
    // Fresh ids, with the edges remapped onto them — otherwise the copy and
    // the original are the same nodes, and dragging one moves both.
    const remap = new Map(c.nodes.map((n) => [n.id, uid()]));
    const nodes = c.nodes.map((n) => ({ ...n, id: remap.get(n.id)!, x: n.x + dx, y: n.y + dy }));
    const edges = c.edges.map((e) => ({
      ...e, id: uid(),
      from: { node: remap.get((e.from as { node: string }).node)! },
      to: { node: remap.get((e.to as { node: string }).node)! },
    }));
    mutate((d) => ({ ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] }), "paste");
    setSel(nodes.map((n) => n.id));
  }, [mutate]);

  const arrange = useCallback((how: Align | "dist-x" | "dist-y") => {
    const ids = new Set(selRef.current);
    if (ids.size < 2) return;
    mutate((d) => {
      const picked = d.nodes.filter((n) => ids.has(n.id));
      const moved = how === "dist-x" ? distributeNodes(picked, "x")
        : how === "dist-y" ? distributeNodes(picked, "y")
        : alignNodes(picked, how);
      const byId = new Map(moved.map((n) => [n.id, n]));
      return { ...d, nodes: d.nodes.map((n) => byId.get(n.id) ?? n) };
    }, "arrange");
  }, [mutate]);

  const download = useCallback(async () => {
    const blob = await exportPng(docRef.current);
    if (!blob) { setNote("Nothing on the board to export."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docRef.current.title.replace(/[^\w.-]+/g, "-") || "board"}.png`;
    a.click();
    // Revoked on the next tick rather than immediately: revoking before the
    // browser has started the download cancels it in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, []);

  const rename = useCallback(() => {
    const next = prompt("Board name", docRef.current.title)?.trim();
    if (!next || next === docRef.current.title) return;
    mutate((d) => ({ ...d, title: next.slice(0, 80) }), "rename");
  }, [mutate]);

  /**
   * Pan to a node and select it.
   *
   * Search on a canvas has to move the view, not just highlight: a hit that is
   * three screens away and merely outlined has not been found in any useful
   * sense. Zoom is left alone — being thrown to a different scale to read one
   * note loses the place you were in.
   */
  const goTo = useCallback((id: string) => {
    const host = hostRef.current;
    const n = docRef.current.nodes.find((m) => m.id === id);
    if (!host || !n) return;
    setView((v) => ({
      ...v,
      x: host.clientWidth / 2 - (n.x + n.w / 2) * v.k,
      y: host.clientHeight / 2 - (n.y + n.h / 2) * v.k,
    }));
    setSel([id]);
  }, []);

  const hits = useMemo(() => searchNodes(doc.nodes, find), [doc.nodes, find]);

  const zoomToFit = useCallback(() => {
    const host = hostRef.current;
    const r = contentBounds(docRef.current);
    if (!host || !r) { setView({ x: 0, y: 0, k: 1 }); return; }
    setView(fitView(r, host.clientWidth, host.clientHeight));
  }, []);

  /** Order matters on a canvas: a note under a shape is a note you cannot read. */
  const restack = useCallback((dir: "front" | "back") => {
    const ids = new Set(selRef.current);
    if (!ids.size) return;
    mutate((d) => {
      const picked = d.nodes.filter((n) => ids.has(n.id));
      const rest = d.nodes.filter((n) => !ids.has(n.id));
      return { ...d, nodes: dir === "front" ? [...rest, ...picked] : [...picked, ...rest] };
    }, "restack");
  }, [mutate]);

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

      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod && k === "c") { copy(); return; }
      if (mod && k === "v") { e.preventDefault(); paste(); return; }
      if (mod && k === "d") { e.preventDefault(); copy(); paste(); return; }
      if (mod && k === "a") { e.preventDefault(); setSel(docRef.current.nodes.map((n) => n.id)); return; }
      if (mod && k === "0") { e.preventDefault(); setView({ x: 0, y: 0, k: 1 }); return; }
      if (mod && k === "1") { e.preventDefault(); zoomToFit(); return; }
      if (mod && k === "f") { e.preventDefault(); setFindOpen(true); return; }
      if (mod && k === "]") { e.preventDefault(); restack("front"); return; }
      if (mod && k === "[") { e.preventDefault(); restack("back"); return; }
      if (mod) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selEdge) removeEdge(selEdge); else removeSelection();
        return;
      }
      if (e.key === "Escape") { setSel([]); setSelEdge(null); setEditing(null); setMenu(null); setTool("select"); return; }

      // Arrow keys nudge — one grid step, or one unit with shift, for the
      // adjustment snapping is otherwise in the way of.
      if (e.key.startsWith("Arrow") && selRef.current.length) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : GRID;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const ids = new Set(selRef.current);
        mutate((d) => ({
          ...d,
          nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
        }), "nudge");
        return;
      }

      const keys: Record<string, Tool> = {
        v: "select", h: "pan", n: "sticky", t: "text", r: "rect", o: "ellipse",
        f: "frame", p: "pen", e: "eraser", a: "arrow",
      };
      if (keys[k]) setTool(keys[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, selEdge, editing, undo, redo, copy, paste, zoomToFit, restack, mutate]);

  /* ── files ────────────────────────────────────────────────────────────── */

  /**
   * Right-click, on anything.
   *
   * Deleting used to mean selecting and then finding either a keyboard or a
   * small ✕ in a header — two steps and a target, for the most common
   * destructive action on a board. A context menu is the one gesture that
   * works the same on a node, an arrow and a stroke.
   */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = toBoard(e);
    const r = hostRef.current?.getBoundingClientRect();
    const at = { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };

    // Topmost first: nodes render in document order, so the last match wins.
    const node = [...docRef.current.nodes].reverse()
      .find((n) => p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h);
    if (node) {
      if (!selRef.current.includes(node.id)) setSel([node.id]);
      setMenu({ ...at, node: node.id });
      return;
    }
    const edge = edgeAt(p.x, p.y, 8 / view.k)[0];
    setMenu(edge ? { ...at, edge: edge.id } : at);
  };

  // Any click elsewhere dismisses it, including one that lands on the canvas.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

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
      onPointerDownCapture={onDownCapture}
      onPointerMoveCapture={onMoveCapture}
      onPointerUpCapture={onUpCapture}
      onPointerCancelCapture={onUpCapture}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={onContextMenu}
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
              stroke={TONE_CSS[s.tone ?? "plain"]} strokeWidth={s.w ?? 2}
              strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {ink && (
            <path d={pathOf(ink)} fill="none" stroke={TONE_CSS[tone]} strokeWidth={penW}
              strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
          )}
          {doc.edges.map((e) => {
            const g = edgeGeom(e);
            if (!g) return null;
            const c = TONE_CSS[e.tone ?? "plain"];
            const on = selEdge === e.id;
            const mid = midpoint(g.p1, g.p2);
            return (
              <g key={e.id}>
                <line x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y}
                  stroke={c} strokeWidth={on ? 3 : 1.5} markerEnd={`url(#bd-ah-${e.tone ?? "plain"})`} />
                {e.label && (
                  <>
                    {/* A chip behind the text, or the arrow reads through it. */}
                    <rect
                      x={mid.x - (e.label.length * 3.4 + 6)} y={mid.y - 9}
                      width={e.label.length * 6.8 + 12} height={18}
                      fill="var(--panel, #0c0d0f)" stroke={c} strokeWidth={0.75}
                    />
                    <text x={mid.x} y={mid.y + 4} textAnchor="middle" fontSize={11} fill="var(--foreground, #f4f5f7)">
                      {e.label}
                    </text>
                  </>
                )}
              </g>
            );
          })}
          {/* Alignment guides: only while a drag is live, and only where an
              edge actually lines up with a neighbour. Guides that are always
              on are wallpaper, and stop being read. */}
          {guides.v.map((x) => (
            <line key={`gv${x}`} x1={x} y1={-100000} x2={x} y2={100000}
              stroke={TONE_CSS.signal} strokeWidth={1 / view.k} strokeDasharray={`${4 / view.k} ${3 / view.k}`} opacity={0.7} />
          ))}
          {guides.h.map((y) => (
            <line key={`gh${y}`} x1={-100000} y1={y} x2={100000} y2={y}
              stroke={TONE_CSS.signal} strokeWidth={1 / view.k} strokeDasharray={`${4 / view.k} ${3 / view.k}`} opacity={0.7} />
          ))}
          {marquee && (
            <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h}
              fill="rgba(255,59,48,0.07)" stroke={TONE_CSS.signal}
              strokeWidth={1 / view.k} strokeDasharray={`${4 / view.k} ${3 / view.k}`} />
          )}
          {/* The node an in-flight arrow would attach to, outlined before you
              let go — otherwise auto-connect is something you only discover
              after the fact. */}
          {wireTarget && byId.get(wireTarget) && (
            <rect
              x={byId.get(wireTarget)!.x - 3} y={byId.get(wireTarget)!.y - 3}
              width={byId.get(wireTarget)!.w + 6} height={byId.get(wireTarget)!.h + 6}
              fill="none" stroke={TONE_CSS.signal} strokeWidth={2 / view.k} />
          )}
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
            selected={sel.includes(n.id)}
            editing={editing === n.id}
            onSelect={(additive) => {
              setSel((cur) =>
                additive
                  ? cur.includes(n.id) ? cur.filter((i) => i !== n.id) : [...cur, n.id]
                  : cur.includes(n.id) ? cur : [n.id]);
            }}
            onEdit={() => setEditing(n.id)}
            onBlur={() => { if (editing === n.id) setEditing(null); }}
            onText={(text) => mutate((d) => ({ ...d, nodes: d.nodes.map((m) => (m.id === n.id ? { ...m, text } : m)) }), `text-${n.id}`)}
            onRemove={() => removeSelection([n.id])}
            onDragStart={(e) => {
              const p = toBoard(e);
              // Drag whatever is selected. Grabbing an unselected node selects
              // it first, so a drag never silently moves something else.
              const ids = selRef.current.includes(n.id) ? selRef.current : [n.id];
              if (!selRef.current.includes(n.id)) setSel([n.id]);

              /*
               * A frame carries what is inside it.
               *
               * By containment, not overlap — the opposite of the marquee
               * rule, and deliberately so. A marquee is a gesture you aim; a
               * frame is a container, and one that grabbed every node it
               * merely touched would drag its neighbours along every time it
               * moved.
               */
              const carried = new Set(ids);
              for (const id of ids) {
                const f = docRef.current.nodes.find((m) => m.id === id);
                if (f?.kind !== "frame") continue;
                for (const inner of nodesInside(f, docRef.current.nodes)) {
                  if (inner.id !== f.id) carried.add(inner.id);
                }
              }

              const origin = new Map(
                docRef.current.nodes.filter((m) => carried.has(m.id)).map((m) => [m.id, { x: m.x, y: m.y }]),
              );
              // dx/dy hold the grab point, so the move branch works in
              // deltas and every member keeps its offset from the others.
              gesture.current = { kind: "move", origin, dx: p.x, dy: p.y };
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
          ["text", "T", "Text (T)"], ["rect", "▭", "Rectangle (R)"], ["ellipse", "◯", "Ellipse (O)"],
          ["frame", "⬚", "Frame — moves what is inside it (F)"],
          ["pen", "✎", "Pen (P)"], ["eraser", "⌫", "Eraser (E)"],
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

      {/*
        Arranging appears only when there is something to arrange. A permanent
        align rail on a board with nothing selected is eight buttons that do
        nothing, which is how a toolbar stops being read.
      */}
      {sel.length > 1 && (
        <div className="bd-arr" onPointerDown={(e) => e.stopPropagation()}>
          <span className="bd-arr-n">{sel.length} SELECTED</span>
          {([
            ["left", "⇤", "Align left"], ["hcentre", "⇹", "Align centres"], ["right", "⇥", "Align right"],
            ["top", "⤒", "Align top"], ["vmiddle", "⇳", "Align middles"], ["bottom", "⤓", "Align bottom"],
            ["dist-x", "⇼", "Space evenly across"], ["dist-y", "⇵", "Space evenly down"],
          ] as [Align | "dist-x" | "dist-y", string, string][]).map(([how, glyph, label]) => (
            <button key={how} title={label} aria-label={label} onClick={() => arrange(how)}>{glyph}</button>
          ))}
          <button title="Bring to front" aria-label="Bring to front" onClick={() => restack("front")}>⌃</button>
          <button title="Send to back" aria-label="Send to back" onClick={() => restack("back")}>⌄</button>
          <button title="Duplicate" aria-label="Duplicate" onClick={() => { copy(); paste(); }}>⧉</button>
          <button title="Delete" aria-label="Delete selection" onClick={() => removeSelection()}>✕</button>
        </div>
      )}

      {findOpen && (
        <div className="bd-find" onPointerDown={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={find}
            placeholder="Find on this board…"
            onChange={(e) => { setFind(e.target.value); setFindAt(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setFindOpen(false); setFind(""); return; }
              if (e.key === "Enter" && hits.length) {
                // Enter walks the hits in document order, wrapping — which is
                // why searchNodes returns them ordered rather than by score.
                const next = (findAt + (e.shiftKey ? -1 : 1) + hits.length) % hits.length;
                setFindAt(next);
                goTo(hits[next]);
              }
            }}
          />
          <span>{find ? `${hits.length ? findAt + 1 : 0}/${hits.length}` : ""}</span>
          <button onClick={() => { setFindOpen(false); setFind(""); }} aria-label="Close find">✕</button>
        </div>
      )}

      {/* Weight, shown only for the tool it belongs to. A pen size sitting
          next to the select arrow is a control that does nothing. */}
      {tool === "pen" && (
        <div className="bd-sizes" onPointerDown={(e) => e.stopPropagation()}>
          {PEN_SIZES.map((w) => (
            <button key={w} className={penW === w ? "on" : ""} title={`Pen ${w}px`} aria-label={`Pen size ${w}`}
              onClick={() => setPenW(w)}>
              <span style={{ width: w + 4, height: w + 4, borderRadius: "50%", background: "currentColor", display: "block" }} />
            </button>
          ))}
        </div>
      )}
      {tool === "text" && (
        <div className="bd-sizes" onPointerDown={(e) => e.stopPropagation()}>
          {TEXT_SIZES.map((f) => (
            <button key={f} className={fontSize === f ? "on" : ""} title={`${f}px text`} aria-label={`Text size ${f}`}
              onClick={() => setFontSize(f)} style={{ fontSize: Math.min(18, f * 0.6) }}>A</button>
          ))}
        </div>
      )}

      {/* Right-click menu. */}
      {menu && (
        <div className="bd-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {menu.node && (
            <>
              <button onClick={() => { setEditing(menu.node!); setMenu(null); }}>Edit text</button>
              <button onClick={() => { copy(); paste(); setMenu(null); }}>Duplicate</button>
              <button onClick={() => { restack("front"); setMenu(null); }}>Bring to front</button>
              <button onClick={() => { restack("back"); setMenu(null); }}>Send to back</button>
              <div className="bd-menu-tones">
                {TONES.map((t) => (
                  <button key={t.id} style={{ background: t.css }} aria-label={`Colour ${t.id}`}
                    onClick={() => {
                      const ids = new Set(selRef.current.length ? selRef.current : [menu.node!]);
                      mutate((d) => ({ ...d, nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, tone: t.id } : n)) }), "tone");
                      setMenu(null);
                    }} />
                ))}
              </div>
              <button className="danger" onClick={() => { removeSelection(selRef.current.length ? selRef.current : [menu.node!]); setMenu(null); }}>
                Delete
              </button>
            </>
          )}
          {menu.edge && (
            <>
              <button onClick={() => {
                const e0 = docRef.current.edges.find((x) => x.id === menu.edge);
                const label = prompt("Arrow label", e0?.label ?? "")?.trim();
                if (label !== undefined) {
                  mutate((d) => ({ ...d, edges: d.edges.map((x) => (x.id === menu.edge ? { ...x, label: label || undefined } : x)) }), "label");
                }
                setMenu(null);
              }}>Label arrow</button>
              <button className="danger" onClick={() => { removeEdge(menu.edge!); setMenu(null); }}>Delete arrow</button>
            </>
          )}
          {!menu.node && !menu.edge && (
            <>
              <button onClick={() => { paste(); setMenu(null); }}>Paste</button>
              <button onClick={() => { setSel(docRef.current.nodes.map((n) => n.id)); setMenu(null); }}>Select all</button>
              <button onClick={() => { zoomToFit(); setMenu(null); }}>Zoom to fit</button>
            </>
          )}
        </div>
      )}

      <div className="bd-hud" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={rename} title="Rename this board" className="bd-title">{doc.title}</button>
        <span><b>{doc.nodes.length}</b> nodes</span>
        <span><b>{doc.strokes.length}</b> strokes</span>
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })} title="Reset zoom (⌘0)">{Math.round(view.k * 100)}%</button>
        <button onClick={zoomToFit} title="Fit everything on screen (⌘1)">FIT</button>
        <button onClick={() => setFindOpen(true)} title="Find on this board (⌘F)">FIND</button>
        <button onClick={() => undo()} title="Undo (⌘Z)">↺</button>
        <button onClick={() => redo()} title="Redo (⇧⌘Z)">↻</button>
        <button onClick={() => setSnapping((v) => !v)} title="Snap to grid — hold alt to override"
          className={snapping ? "on" : ""}>{snapping ? "SNAP" : "FREE"}</button>
        <button onClick={() => void download()} title="Export the whole board as a PNG">PNG</button>
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
  onSelect: (additive: boolean) => void;
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

  const label = n.kind === "sticky" ? "NOTE" : n.kind === "text" ? "TEXT"
    : n.kind === "rect" ? "BOX" : n.kind === "ellipse" ? "OVAL" : n.kind === "frame" ? "FRAME"
    : n.kind === "image" ? "IMAGE" : "FILE";

  /*
   * Text is not a sticky note with the colour turned off.
   *
   * A sticky is an object on the board — it has an edge, it sits on top of
   * things, you move it around. Text is a label *on* the board: no card, no
   * header, no border, and it is set at whatever size it was created at. They
   * were the same component with the same chrome, which made the two tools
   * feel like one tool with a bug.
   */
  const bareText = n.kind === "text";

  return (
    <div
      className={`bd-n k-${n.kind} t-${n.tone ?? "plain"}${selected ? " sel" : ""}`}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h, fontSize: n.fontSize }}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(e.shiftKey || e.metaKey); }}
      // Shapes are labelled too — a box you cannot title is a box you have to
      // annotate with a note beside it.
      onDoubleClick={() => { if (n.kind !== "image" && n.kind !== "file") onEdit(); }}
    >
      {!bareText && (
        <header className="bd-n-hd" onPointerDown={(e) => { e.stopPropagation(); onSelect(e.shiftKey || e.metaKey); onDragStart(e); }}>
          <span>{label}</span>
          <button title="Delete" aria-label="Delete node"
            onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}>✕</button>
        </header>
      )}

      <div
        className="bd-n-body"
        // With no header, the text itself is the drag handle — otherwise a
        // bare label is a thing you can create and never move again.
        onPointerDown={bareText && !editing
          ? (e) => { e.stopPropagation(); onSelect(e.shiftKey || e.metaKey); onDragStart(e); }
          : undefined}
      >
        {(n.kind === "sticky" || n.kind === "text" || n.kind === "rect" || n.kind === "ellipse" || n.kind === "frame") && (
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
              {n.text || (
                <span style={{ color: "var(--subtle)" }}>
                  {n.kind === "rect" || n.kind === "ellipse" || n.kind === "frame"
                    ? "Double-click to label"
                    : "Double-click to write"}
                </span>
              )}
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

      <span className="bd-rz" onPointerDown={(e) => { e.stopPropagation(); onSelect(false); onResizeStart(e); }} />
    </div>
  );
}
