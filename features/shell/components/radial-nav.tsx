"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard, Sunrise, MessageSquare, CandlestickChart, Briefcase, Wallet,
  FolderKanban, BookOpen, Boxes, Shapes, GraduationCap, Zap, Brain, Network, Bot,
  Settings, Orbit, X, type LucideIcon,
} from "lucide-react";
import { sound } from "@/lib/sound";

interface Item { href: string; label: string; icon: LucideIcon }
const PAGES: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/morning", label: "Morning", icon: Sunrise },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/markets", label: "Markets", icon: CandlestickChart },
  { href: "/career", label: "Career", icon: Briefcase },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/workspace", label: "Workspace", icon: FolderKanban },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/lab", label: "Holo-Lab", icon: Boxes },
  { href: "/forge", label: "Forge", icon: Shapes },
  { href: "/review", label: "Review", icon: GraduationCap },
  { href: "/automations", label: "Automations", icon: Zap },
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
  const router = useRouter();
  const pathname = usePathname();
  const ringRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastAngle = useRef(0);

  const N = PAGES.length;
  const step = TAU / N;
  // Which item sits nearest the top slot right now.
  const activeIndex = ((Math.round(-rot / step) % N) + N) % N;

  const go = useCallback((href: string) => {
    sound.blip?.();
    setOpen(false);
    if (!pathname.startsWith(href)) router.push(href);
  }, [router, pathname]);

  // open on this page → align the wheel to the current page
  useEffect(() => {
    if (!open) return;
    const i = PAGES.findIndex((p) => pathname.startsWith(p.href));
    if (i >= 0) setRot(-i * step);
  }, [open, pathname, step]);

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
      else if (/home|main/.test(s)) best = PAGES.findIndex((p) => p.href === "/dashboard");
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
      setRot(-i * step);
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
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") setRot((r) => r - step);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setRot((r) => r + step);
      else if (e.key === "Enter") go(PAGES[activeIndex].href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, activeIndex, go]);

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

  const R = 190; // ring radius (px)
  const Active = PAGES[activeIndex].icon;

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
            className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur-2xl"
            onClick={() => setOpen(false)}
          >
            <button className="absolute right-6 top-6 text-muted transition-colors hover:text-foreground" onClick={() => setOpen(false)} aria-label="Close"><X className="size-5" /></button>
            <p className="lbl absolute top-10 !text-[9px] !tracking-[4px] text-subtle">SPIN · SCROLL · SELECT</p>

            <motion.div
              ref={ringRef}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="relative touch-none select-none"
              style={{ width: R * 2 + 120, height: R * 2 + 120 }}
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
              {PAGES.map((p, i) => {
                const ang = i * step + rot + TOP;
                const cx = R * 2 / 2 + 60;
                const x = cx + R * Math.cos(ang);
                const y = cx + R * Math.sin(ang);
                const active = i === activeIndex;
                const Icon = p.icon;
                return (
                  <button
                    key={p.href}
                    onClick={() => go(p.href)}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
                    style={{ left: x, top: y }}
                  >
                    <motion.span
                      animate={{ scale: active ? 1.35 : 1, opacity: active ? 1 : 0.5 }}
                      className="flex items-center justify-center rounded-full border"
                      style={{
                        width: 44, height: 44,
                        borderColor: active ? "var(--live)" : "var(--border-glass)",
                        background: active ? "color-mix(in srgb, var(--live) 16%, transparent)" : "var(--panel)",
                        color: active ? "var(--live)" : "var(--muted)",
                        boxShadow: active ? "0 0 24px -6px var(--live-glow)" : "none",
                      }}
                    >
                      <Icon className="size-[18px]" strokeWidth={1.7} />
                    </motion.span>
                    <span className="text-[9px] tracking-wide" style={{ color: active ? "var(--foreground)" : "var(--subtle)", opacity: active ? 1 : 0.6 }}>{p.label}</span>
                  </button>
                );
              })}

              {/* centre = go to active */}
              <button
                onClick={() => go(PAGES[activeIndex].href)}
                className="absolute left-1/2 top-1/2 flex size-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border border-border-glass-strong bg-[var(--panel-hi)]/80 text-foreground backdrop-blur-xl transition-colors hover:border-[var(--live-dim)]"
              >
                <Active className="size-6 text-[var(--live)]" strokeWidth={1.6} />
                <span className="text-[11px] font-medium">{PAGES[activeIndex].label}</span>
                <span className="lbl !text-[7px] !tracking-[2px]">ENTER →</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
