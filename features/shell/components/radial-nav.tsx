"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard, Sunrise, MessageSquare, CandlestickChart, Briefcase, Wallet,
  FolderKanban, BookOpen, Boxes, Shapes, GraduationCap, Zap, Brain, Network, Bot,
  Settings, Orbit, X, Activity, ScrollText, BookMarked, Mail, Code2, type LucideIcon,
  Scale, GitBranch, Radio, FileSearch, CalendarDays,
} from "lucide-react";
import { sound } from "@/lib/sound";

interface Item { href: string; label: string; icon: LucideIcon }
const PAGES: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sitrep", label: "Sitrep", icon: Radio },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/morning", label: "Morning", icon: Sunrise },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/markets", label: "Markets", icon: CandlestickChart },
  { href: "/career", label: "Career", icon: Briefcase },
  { href: "/mail", label: "Mail", icon: Mail },
  { href: "/code", label: "Code", icon: Code2 },
  { href: "/push", label: "Push", icon: GitBranch },
  { href: "/health", label: "Health", icon: Activity },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/workspace", label: "Workspace", icon: FolderKanban },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/lab", label: "Holo-Lab", icon: Boxes },
  { href: "/forge", label: "Forge", icon: Shapes },
  { href: "/report", label: "Report", icon: ScrollText },
  { href: "/education", label: "Education", icon: GraduationCap },
  { href: "/review", label: "Review", icon: BookMarked },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/decisions", label: "Decisions", icon: Scale },
  { href: "/counsel", label: "Counsel", icon: FileSearch },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/graph", label: "Mind Graph", icon: Network },
  { href: "/agents", label: "Agent", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2; // active slot at 12 o'clock

/** Rotary launcher: a side button opens a wheel of every page. Drag or scroll to
 *  spin it; the page at the top is selected; click a page (or the centre) to go. */
export function RadialNav() {
  const [open, setOpen] = useState(false);
  const [rot, setRot] = useState(0);
  const [R, setR] = useState(190); // ring radius — responsive so it fits phones
  /**
   * Typed filter.
   *
   * The wheel was designed for a dozen pages and now carries twenty-six. Past
   * about eighteen, spinning stops being a shortcut and becomes a chore — you
   * are hunting a target you cannot see the label of. Typing narrows the ring
   * to what matches, which keeps the wheel as the fast path rather than the
   * slow one.
   */
  const [filter, setFilter] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const ringRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastAngle = useRef(0);
  // Mirrors of open/rot for the gesture handlers, which are bound once and
  // would otherwise read values captured at their first render.
  const openRef = useRef(open);
  openRef.current = open;
  const rotRef = useRef(rot);
  rotRef.current = rot;

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return PAGES;
    const hits = PAGES.filter((p) => p.label.toLowerCase().includes(q) || p.href.slice(1).includes(q));
    // Never filter down to nothing — an empty wheel looks broken and gives no
    // way back except deleting characters you cannot see the effect of.
    return hits.length ? hits : PAGES;
  }, [filter]);

  // The gesture handlers are bound once and would otherwise close over the
  // unfiltered list from their first render.
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const N = shown.length;
  const step = TAU / N;
  // Which item sits nearest the top slot right now.
  const activeIndex = ((Math.round(-rot / step) % N) + N) % N;
  const activePage = shown[activeIndex] ?? shown[0];

  // Ratchet click as each page clicks past the selector while rotating.
  const prevActive = useRef(activeIndex);
  useEffect(() => {
    if (open && prevActive.current !== activeIndex) sound.detent?.();
    prevActive.current = activeIndex;
  }, [activeIndex, open]);

  // A new filter means a new ring; leaving the old rotation would land the
  // selector on an arbitrary match.
  useEffect(() => { setRot(0); }, [filter]);

  const go = useCallback((href: string) => {
    sound.blip?.();
    setOpen(false);
    setFilter("");
    if (!pathname.startsWith(href)) router.push(href);
  }, [router, pathname]);

  /**
   * Size the ring to the viewport and to how many nodes are on it.
   *
   * A fixed radius that fitted twelve pages puts twenty-six shoulder to
   * shoulder. Each node needs roughly 46px of arc to stay separate, so the
   * radius has a floor derived from the count rather than a constant — and it
   * is still capped by the viewport, because overflowing is worse than tight.
   */
  useEffect(() => {
    const fit = () => {
      const m = Math.min(window.innerWidth, window.innerHeight);
      const viewportMax = (m - 130) / 2;
      const needed = (N * 46) / TAU;                 // arc length per node → radius
      setR(Math.max(110, Math.min(Math.max(190, needed), viewportMax)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [N]);

  // open on this page → align the wheel to the current page
  useEffect(() => {
    if (!open) return;
    const i = shown.findIndex((p) => pathname.startsWith(p.href));
    if (i >= 0) setRot(-i * step);
  }, [open, pathname, step, shown]);

  /**
   * Gesture control surface.
   *
   * The wheel is driven by events rather than exposing its state, so the
   * gesture layer never has to know how rotation is stored — and the hand,
   * the mouse and the keyboard all move the same wheel.
   *
   *   sage:nav-open   — 🤙 raises the wheel
   *   sage:nav-rotate — palm twist; detail.steps is signed detents
   *   sage:nav-select — 👌 opens whatever is in the selector
   *   sage:nav-close  — hand lost, or cancelled
   */
  useEffect(() => {
    const onOpen = () => { sound.swoosh?.(); setOpen(true); };
    const onClose = () => setOpen(false);
    const onRotate = (e: Event) => {
      const steps = (e as CustomEvent<{ steps?: number }>).detail?.steps ?? 0;
      if (!steps) return;
      setRot((r) => r - steps * step);
    };
    const onSelect = () => {
      // Read live values from refs. Navigating inside a setState updater looked
      // tempting for the same reason, but updaters must stay pure — React is
      // free to run them twice or discard them, and the navigation simply
      // never happened.
      if (!openRef.current) return;
      const i = ((Math.round(-rotRef.current / step) % N) + N) % N;
      // The ring may be filtered, so the index means a position in `shown`,
      // not in PAGES. Reading the full list here opened whatever page happened
      // to sit at that index instead of the one under the selector.
      go(shownRef.current[i]?.href ?? PAGES[i].href);
    };
    window.addEventListener("sage:nav-open", onOpen);
    window.addEventListener("sage:nav-close", onClose);
    window.addEventListener("sage:nav-rotate", onRotate);
    window.addEventListener("sage:nav-select", onSelect);
    return () => {
      window.removeEventListener("sage:nav-open", onOpen);
      window.removeEventListener("sage:nav-close", onClose);
      window.removeEventListener("sage:nav-rotate", onRotate);
      window.removeEventListener("sage:nav-select", onSelect);
    };
  }, [step, N, go]);

  // Fuzzy-match a spoken/typed target to a page.
  const matchPage = useCallback((q: string): number => {
    const s = q.toLowerCase().replace(/[^a-z ]/g, "").trim();
    let best = -1, bestLen = 0;
    PAGES.forEach((p, i) => {
      const label = p.label.toLowerCase();
      const href = p.href.slice(1);
      if (s.includes(label) || s.includes(href) || label.includes(s) || (s.length > 2 && href.includes(s))) {
        if (label.length > bestLen) { best = i; bestLen = label.length; }
      }
    });
    // a few aliases
    if (best < 0) {
      if (/task|to.?do|work/.test(s)) best = PAGES.findIndex((p) => p.href === "/workspace");
      else if (/money|stock|crypto|invest/.test(s)) best = PAGES.findIndex((p) => p.href === "/portfolio");
      else if (/job|intern|applic/.test(s)) best = PAGES.findIndex((p) => p.href === "/career");
      else if (/note|doc|learn/.test(s)) best = PAGES.findIndex((p) => p.href === "/knowledge");
      else if (/sleep|steps|workout|fitness|gym|body/.test(s)) best = PAGES.findIndex((p) => p.href === "/health");
      else if (/home|main/.test(s)) best = PAGES.findIndex((p) => p.href === "/dashboard");
      else if (/calendar|schedule|month|diary|timetable/.test(s)) best = PAGES.findIndex((p) => p.href === "/calendar");
      else if (/sitrep|status|situation|where.*stand/.test(s)) best = PAGES.findIndex((p) => p.href === "/sitrep");
      else if (/dossier|counsel|what if|play out|about them/.test(s)) best = PAGES.findIndex((p) => p.href === "/counsel");
      else if (/decision|call|bet|judge|calibrat/.test(s)) best = PAGES.findIndex((p) => p.href === "/decisions");
      else if (/push|git|hub|commit|solution|dsa/.test(s)) best = PAGES.findIndex((p) => p.href === "/push");
    }
    return best;
  }, []);

  // Voice / external triggers.
  useEffect(() => {
    const onOpen = () => { sound.swoosh?.(); setOpen(true); };
    const onNav = (e: Event) => {
      const q = String((e as CustomEvent).detail ?? "");
      const i = matchPage(q);
      if (i < 0) return;
      setOpen(true);
      // matchPage indexes the full list, so any filter has to go before the
      // rotation is set against it.
      setFilter("");
      setRot(-i * (TAU / PAGES.length));
      // let the wheel visibly spin to it, then navigate
      window.setTimeout(() => go(PAGES[i].href), 620);
    };
    window.addEventListener("sage:open-wheel", onOpen);
    window.addEventListener("sage:navigate", onNav as EventListener);
    return () => {
      window.removeEventListener("sage:open-wheel", onOpen);
      window.removeEventListener("sage:navigate", onNav as EventListener);
    };
  }, [matchPage, step, go]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Escape clears a filter first, and only closes an unfiltered wheel —
        // otherwise a typo costs you the whole launcher.
        if (filter) setFilter("");
        else setOpen(false);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") setRot((r) => r - step);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setRot((r) => r + step);
      else if (e.key === "Enter") go(activePage.href);
      else if (e.key === "Backspace") setFilter((f) => f.slice(0, -1));
      // Any printable character starts filtering, with no box to click into
      // first. The wheel is a launcher; asking someone to aim at an input
      // before they can type is the thing launchers exist to avoid.
      else if (e.key.length === 1 && /[a-z0-9 ]/i.test(e.key)) setFilter((f) => f + e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, activeIndex, go, activePage, filter]);

  const center = () => {
    const el = ringRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const angleAt = (clientX: number, clientY: number) => {
    const c = center();
    return Math.atan2(clientY - c.y, clientX - c.x);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    lastAngle.current = angleAt(e.clientX, e.clientY);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const a = angleAt(e.clientX, e.clientY);
    let d = a - lastAngle.current;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    lastAngle.current = a;
    setRot((r) => r + d);
  };
  const onPointerUp = () => {
    dragging.current = false;
    setRot((r) => Math.round(r / step) * step); // snap to nearest page
  };
  const onWheel = (e: React.WheelEvent) => {
    setRot((r) => r - Math.sign(e.deltaY) * step);
  };

  const Active = activePage.icon;
  const box = R * 2 + 64; // container size; nodes are unlabelled now

  return (
    <>
      {/* side trigger */}
      <button
        onClick={() => { sound.swoosh?.(); setOpen(true); }}
        title="Page wheel"
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
            className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-background/80 backdrop-blur-2xl"
            onClick={() => setOpen(false)}
          >
            <button className="absolute right-6 top-6 text-muted transition-colors hover:text-foreground" onClick={() => setOpen(false)} aria-label="Close"><X className="size-5" /></button>
            <div className="absolute top-9 flex flex-col items-center gap-2">
              <p className="lbl !text-[9px] !tracking-[4px] text-subtle">
                {filter ? "TYPE TO NARROW · ENTER TO OPEN" : "SPIN OR TYPE · ENTER TO OPEN"}
              </p>
              {/* Shown only once he starts typing: an always-present search box
                  would compete with the wheel for the first glance. */}
              {filter && (
                <span
                  className="flex items-center gap-2 rounded-full border border-[var(--live-dim)] bg-[var(--panel-hi)]/80 px-3 py-1 font-mono text-[12px] text-[var(--live)] backdrop-blur-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {filter}
                  <b className="font-normal text-subtle">{N} of {PAGES.length}</b>
                </span>
              )}
            </div>

            <motion.div
              ref={ringRef}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="relative touch-none select-none"
              style={{ width: box, height: box }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onWheel={onWheel}
            >
              {/* selection marker at top */}
              <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2" style={{ marginTop: 6 }}>
                <div className="size-2 rotate-45 border border-[var(--live)] bg-[var(--live)]" />
              </div>
              {/* faint ring */}
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-glass" style={{ width: R * 2, height: R * 2 }} />

              {/* items */}
              {shown.map((p, i) => {
                const ang = i * step + rot + TOP;
                const cx = box / 2;
                const x = cx + R * Math.cos(ang);
                const y = cx + R * Math.sin(ang);
                const active = i === activeIndex;
                const Icon = p.icon;
                return (
                  <button
                    key={p.href}
                    // Only the page under the selector opens. Tapping any other
                    // spins it up to the top instead — clicking an off-selector
                    // item used to navigate straight there, which made the
                    // highlight meaningless and fired the wrong page on a
                    // mis-tap.
                    onClick={() => (active ? go(p.href) : setRot(-i * step))}
                    aria-current={active ? "true" : undefined}
                    title={active ? `Open ${p.label}` : `Select ${p.label}`}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
                    style={{ left: x, top: y, cursor: active ? "pointer" : "grab" }}
                  >
                    <motion.span
                      animate={{ scale: active ? 1.4 : 1, opacity: active ? 1 : 0.34 }}
                      className="flex items-center justify-center rounded-full border"
                      style={{
                        width: 40, height: 40,
                        borderColor: active ? "var(--live)" : "var(--border-glass)",
                        background: active ? "color-mix(in srgb, var(--live) 16%, transparent)" : "var(--panel)",
                        color: active ? "var(--live)" : "var(--muted)",
                        boxShadow: active ? "0 0 24px -6px var(--live-glow)" : "none",
                      }}
                    >
                      <Icon className="size-[17px]" strokeWidth={1.7} />
                    </motion.span>
                    {/* No label per node. Twenty-six of them overlapped into
                        noise, and the centre already names the selection —
                        printing it twice cost legibility for nothing. */}
                  </button>
                );
              })}

              {/* centre = go to active */}
              <button
                onClick={() => go(activePage.href)}
                className="absolute left-1/2 top-1/2 flex size-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border border-border-glass-strong bg-[var(--panel-hi)]/80 text-foreground backdrop-blur-xl transition-colors hover:border-[var(--live-dim)]"
              >
                <Active className="size-6 text-[var(--live)]" strokeWidth={1.6} />
                <span className="text-[11px] font-medium">{activePage.label}</span>
                <span className="lbl !text-[7px] !tracking-[2px]">ENTER →</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
