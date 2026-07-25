"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Hand } from "lucide-react";
import { useShellStore } from "@/features/shell/store";
import { HandController, type HandFrame } from "@/features/forge/hands";

// Page order for swipe navigation.
const ROUTES = [
  "/dashboard", "/chat", "/markets", "/workspace", "/knowledge",
  "/lab", "/forge", "/automations", "/memory", "/graph", "/agents", "/settings",
];

const SCROLL_DEAD = 0.16;   // half-height of the no-scroll zone around centre
const SCROLL_GAIN = 42;     // px per frame at full deflection
const OPEN_MIN = 1.35;      // hand must be reasonably open to drive scroll/swipe
const SWIPE_DX = 0.28;      // horizontal travel that counts as a swipe
const SWIPE_MS = 500;       // ...within this window
const SWIPE_COOLDOWN = 1300;

/**
 * Hands-free gesture navigation (opt-in). With an open palm: raise your hand to
 * scroll up, lower it to scroll down (joystick style, dead zone in the middle);
 * swipe left/right to flip between pages. Uses the same MediaPipe tracker as the
 * Forge, lazy-loaded only when enabled. A small camera preview + status chip show
 * while it's live. Everything degrades to a friendly message on camera failure.
 */
export function GestureNav() {
  const enabled = useShellStore((s) => s.gestureNav);
  const setGestureNav = useShellStore((s) => s.setGestureNav);
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const videoRef = useRef<HTMLVideoElement>(null);
  const ctrl = useRef<HandController | null>(null);
  const [status, setStatus] = useState<string>("");
  const [dir, setDir] = useState<"up" | "down" | null>(null);

  const swipeHist = useRef<{ t: number; x: number }[]>([]);
  const lastSwipe = useRef(0);

  const navigate = useCallback((delta: number) => {
    const i = ROUTES.findIndex((r) => pathRef.current.startsWith(r));
    const next = ROUTES[Math.min(ROUTES.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))];
    if (next && !pathRef.current.startsWith(next)) router.push(next);
  }, [router]);

  const scroller = () => document.querySelector("main") as HTMLElement | null;

  const onFrame = useCallback((f: HandFrame | null) => {
    if (!f || f.openness < OPEN_MIN) { setDir(null); swipeHist.current = []; return; }
    const now = performance.now();

    // --- joystick scroll from vertical palm position ---
    const off = f.palmY - 0.5;
    if (Math.abs(off) > SCROLL_DEAD) {
      const amt = Math.sign(off) * (Math.abs(off) - SCROLL_DEAD) * SCROLL_GAIN * 3;
      (scroller() ?? document.scrollingElement ?? document.documentElement)?.scrollBy({ top: amt });
      setDir(off < 0 ? "up" : "down");
    } else {
      setDir(null);
    }

    // --- horizontal swipe → page nav ---
    const hist = swipeHist.current;
    hist.push({ t: now, x: f.palmX });
    while (hist.length && now - hist[0].t > SWIPE_MS) hist.shift();
    if (hist.length > 2 && now - lastSwipe.current > SWIPE_COOLDOWN) {
      const dx = f.palmX - hist[0].x;
      if (Math.abs(dx) > SWIPE_DX) {
        lastSwipe.current = now;
        swipeHist.current = [];
        navigate(dx < 0 ? 1 : -1); // swipe left → next page
      }
    }
  }, [navigate]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus("Loading vision model…");
    const c = new HandController(onFrame);
    (async () => {
      try {
        await c.start(videoRef.current!);
        if (cancelled) { c.stop(); return; }
        ctrl.current = c;
        setStatus("Open palm · raise/lower to scroll · swipe to change page");
      } catch (err) {
        setStatus(
          /denied|NotAllowed/i.test(String(err))
            ? "Camera blocked — allow access to use gestures."
            : "Couldn't start gesture control on this device.",
        );
        // auto-disable so the toggle reflects reality
        setGestureNav(false);
      }
    })();
    return () => {
      cancelled = true;
      c.stop();
      ctrl.current = null;
      setDir(null);
    };
  }, [enabled, onFrame, setGestureNav]);

  if (!enabled) return null;

  return (
    <div className="gn-wrap">
      <video ref={videoRef} muted playsInline className="gn-cam" />
      <div className="gn-chip">
        <Hand className="size-3.5" />
        <span>{status}</span>
      </div>
      {dir && <div className={`gn-arrow ${dir}`}>{dir === "up" ? "▲" : "▼"}</div>}
    </div>
  );
}
