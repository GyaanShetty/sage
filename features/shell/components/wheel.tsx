"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Orbit, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { sound } from "@/lib/sound";
import { PAGES } from "./pages";
import "./wheel.css";

/**
 * The wheel, back — as a half.
 *
 * The full ring was lovely at twelve pages and unreadable at twenty-six,
 * because every label had to sit under its node and the nodes at the left and
 * right edges are stacked horizontally. Anchoring the wheel to the screen edge
 * fixes exactly that: the visible arc runs top-to-bottom, so nodes are
 * separated *vertically* and their labels extend into open space to the right.
 * Labels can never collide with each other again — the geometry rules it out
 * rather than the styling hiding it.
 *
 * It is also a smaller gesture than a full-page launcher. The centre sits off
 * the edge of the screen, so the wheel reads as a dial you have pulled out
 * from the side rather than a mode you have entered.
 */

const TAU = Math.PI * 2;
/** Half the arc the visible nodes span, in radians. Beyond this they fade out. */
const SPREAD = (78 * Math.PI) / 180;
/** Nodes on screen at once. The rest are on the wheel, just rotated away. */
const VISIBLE = 9;

export function Wheel() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [R, setR] = useState(320);
  const [height, setHeight] = useState(700);

  const dragging = useRef(false);
  const lastY = useRef(0);
  const accum = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const indexRef = useRef(index);
  indexRef.current = index;

  const N = PAGES.length;
  /** Angle between adjacent nodes, so exactly VISIBLE fit across the arc. */
  const step = useMemo(() => (SPREAD * 2) / (VISIBLE - 1), []);

  const go = useCallback((href: string) => {
    sound.blip?.();
    setOpen(false);
    if (!pathname.startsWith(href)) router.push(href);
  }, [pathname, router]);

  /**
   * Radius from the viewport height.
   *
   * The arc has to reach from near the top of the screen to near the bottom
   * without the outermost nodes leaving it, so the radius follows the height
   * rather than being a constant that happens to suit a laptop.
   */
  useEffect(() => {
    const fit = () => {
      const h = window.innerHeight;
      setHeight(h);
      // Half the height divided by sin(SPREAD) puts the outermost node exactly
      // at the edge; backing off a little keeps it comfortably inside.
      setR(Math.min(window.innerWidth * 0.82, (h / 2) / Math.sin(SPREAD) * 0.88));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Open on the page you are already on.
  useEffect(() => {
    if (!open) return;
    const i = PAGES.findIndex((p) => pathname.startsWith(p.href));
    if (i >= 0) setIndex(i);
  }, [open, pathname]);

  // A detent as each page passes the selector, so the dial has a feel.
  const prev = useRef(index);
  useEffect(() => {
    if (open && prev.current !== index) sound.detent?.();
    prev.current = index;
  }, [index, open]);

  const move = useCallback((by: number) => {
    setIndex((i) => ((i + by) % N + N) % N);
  }, [N]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") move(-1);
      else if (e.key === "Enter") go(PAGES[indexRef.current].href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, move, go]);

  /** The bus the old wheel answered to, kept intact. */
  useEffect(() => {
    const onOpen = () => { sound.swoosh?.(); setOpen(true); };
    const onClose = () => setOpen(false);
    const onRotate = (e: Event) => move((e as CustomEvent<{ steps?: number }>).detail?.steps ?? 0);
    const onSelect = () => { if (openRef.current) go(PAGES[indexRef.current].href); };
    const onNav = (e: Event) => {
      const q = String((e as CustomEvent).detail ?? "").trim().toLowerCase();
      const i = PAGES.findIndex((p) => p.label.toLowerCase().includes(q) || p.href.slice(1).includes(q));
      if (i < 0) return;
      setOpen(true);
      setIndex(i);
      // Let the dial visibly turn to it rather than teleporting.
      window.setTimeout(() => go(PAGES[i].href), 560);
    };

    window.addEventListener("sage:open-wheel", onOpen);
    window.addEventListener("sage:nav-open", onOpen);
    window.addEventListener("sage:nav-close", onClose);
    window.addEventListener("sage:nav-rotate", onRotate as EventListener);
    window.addEventListener("sage:nav-select", onSelect);
    window.addEventListener("sage:navigate", onNav as EventListener);
    return () => {
      window.removeEventListener("sage:open-wheel", onOpen);
      window.removeEventListener("sage:nav-open", onOpen);
      window.removeEventListener("sage:nav-close", onClose);
      window.removeEventListener("sage:nav-rotate", onRotate as EventListener);
      window.removeEventListener("sage:nav-select", onSelect);
      window.removeEventListener("sage:navigate", onNav as EventListener);
    };
  }, [move, go]);

  // ── gestures ─────────────────────────────────────────────────────────
  // Vertical drag, because the arc is vertical: dragging down should bring the
  // lower pages up, the way a physical dial would.
  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    lastY.current = e.clientY;
    accum.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    accum.current += e.clientY - lastY.current;
    lastY.current = e.clientY;
    // One node per ~52px of travel: enough that a flick moves several without
    // the dial feeling slippery.
    const nodes = Math.trunc(accum.current / 52);
    if (nodes !== 0) { move(-nodes); accum.current -= nodes * 52; }
  };
  const onPointerUp = () => { dragging.current = false; };
  const onWheel = (e: React.WheelEvent) => move(Math.sign(e.deltaY));

  const active = PAGES[index];
  const ActiveIcon = active.icon;

  return (
    <>
      <button
        onClick={() => { sound.swoosh?.(); setOpen(true); }}
        title="Pages"
        className="fixed left-0 top-1/2 z-40 -translate-y-1/2 rounded-r-xl border border-l-0 border-border-glass bg-[var(--panel-hi)]/90 py-4 pl-1.5 pr-2 text-[var(--live)] backdrop-blur-xl transition-transform hover:translate-x-0.5 md:pl-2 md:pr-2.5"
      >
        <Orbit className="size-5" strokeWidth={1.6} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="wh-scrim"
            onClick={() => setOpen(false)}
          >
            <button className="wh-close" onClick={() => setOpen(false)} aria-label="Close"><X className="size-5" /></button>

            <motion.div
              // The hub sits off the left edge — the dial is pulled out from
              // the side of the screen rather than floating in the middle.
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="wh-stage"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
            >
              {/* The rim: the arc the nodes ride on. */}
              <svg className="wh-rim" width={R + 60} height={height} aria-hidden>
                <path
                  d={`M ${R * Math.cos(-SPREAD)} ${height / 2 + R * Math.sin(-SPREAD)}
                      A ${R} ${R} 0 0 1 ${R * Math.cos(SPREAD)} ${height / 2 + R * Math.sin(SPREAD)}`}
                  fill="none"
                  stroke="var(--border-glass)"
                  strokeWidth={1}
                />
              </svg>

              {PAGES.map((p, i) => {
                // Distance from the selector, wrapped, so the wheel is endless
                // in both directions rather than stopping at the ends.
                let d = i - index;
                if (d > N / 2) d -= N;
                if (d < -N / 2) d += N;

                const half = (VISIBLE - 1) / 2;
                // Anything past the arc is on the back of the wheel.
                if (Math.abs(d) > half + 1) return null;

                const ang = d * step;
                const x = R * Math.cos(ang);
                const y = height / 2 + R * Math.sin(ang);
                const activeNode = d === 0;
                // Fade toward the ends so the arc dissolves rather than being
                // chopped off, which is what makes it read as a wheel.
                const fade = Math.max(0, 1 - Math.abs(d) / (half + 0.6));
                const Icon = p.icon;

                return (
                  <button
                    key={p.href}
                    onClick={() => (activeNode ? go(p.href) : setIndex(i))}
                    className={cn("wh-node", activeNode && "active")}
                    style={{
                      left: x,
                      top: y,
                      opacity: activeNode ? 1 : 0.25 + fade * 0.5,
                      transform: `translate(-50%, -50%) scale(${activeNode ? 1 : 0.86 + fade * 0.08})`,
                      pointerEvents: fade <= 0.05 ? "none" : "auto",
                    }}
                    title={p.label}
                  >
                    <span className="wh-dot"><Icon className="size-[17px]" strokeWidth={1.7} /></span>
                    {/* Labels run rightward into empty space. On a vertical arc
                        they stack instead of overlapping, which is the whole
                        reason this shape works where the full ring did not. */}
                    <span className="wh-label">
                      {p.label}
                      {p.hint && activeNode && <i>{p.hint}</i>}
                    </span>
                  </button>
                );
              })}

              {/* The selector, at the hub's eye level. */}
              <div className="wh-selector" style={{ top: height / 2 }}>
                <span className="wh-marker" />
              </div>

              <button className="wh-enter" style={{ top: height / 2 }} onClick={() => go(active.href)}>
                <ActiveIcon className="size-4" />
                <span>{active.label}</span>
                <i>ENTER</i>
              </button>
            </motion.div>

            <p className="wh-hint">DRAG · SCROLL · ⌘K TO SEARCH</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
