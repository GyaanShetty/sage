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

const OPEN_MIN = 1.45;        // open palm → twist-to-scroll mode
const FIST_MAX = 1.15;        // closed fist → page-change mode
const ROLL_DEAD = 0.02;       // ignore tiny wobble (radians/frame)
const ROLL_GAIN = 900;        // px scrolled per radian of twist
const FIST_DEVIATE = 0.16;    // how far a fist must slide sideways to flip a page
const NAV_COOLDOWN = 1100;

function angleDelta(a: number, b: number): number {
  let d = a - b;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Hands-free gesture navigation (opt-in). Open palm → twist your hand like
 * rolling a ball to scroll (rotate clockwise to go down, back to go up — twist
 * more/faster to scroll more). Make a fist and slide it left/right to flip
 * between pages. Uses the same MediaPipe tracker as the Forge, lazy-loaded only
 * when enabled. A small camera preview + status chip show while it's live;
 * everything degrades to a friendly message on camera failure.
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

  const prevRoll = useRef<number | null>(null);
  const fistAnchor = useRef<number | null>(null);
  const lastNav = useRef(0);

  const navigate = useCallback((delta: number) => {
    const i = ROUTES.findIndex((r) => pathRef.current.startsWith(r));
    const next = ROUTES[Math.min(ROUTES.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))];
    if (next && !pathRef.current.startsWith(next)) router.push(next);
  }, [router]);

  const scroller = () => document.querySelector("main") as HTMLElement | null;

  const onFrame = useCallback((f: HandFrame | null) => {
    if (!f) { setDir(null); prevRoll.current = null; fistAnchor.current = null; return; }
    const now = performance.now();

    // ---- OPEN PALM → twist to scroll (like rolling a ball) ----
    if (f.openness >= OPEN_MIN) {
      fistAnchor.current = null;
      if (prevRoll.current !== null) {
        const d = angleDelta(f.roll, prevRoll.current);
        if (Math.abs(d) > ROLL_DEAD) {
          const amt = d * ROLL_GAIN; // clockwise twist → positive → scroll down
          (scroller() ?? document.scrollingElement ?? document.documentElement)?.scrollBy({ top: amt });
          setDir(amt > 0 ? "down" : "up");
        } else {
          setDir(null);
        }
      }
      prevRoll.current = f.roll;
      return;
    }

    // ---- CLOSED FIST → slide left/right to change page ----
    prevRoll.current = null;
    setDir(null);
    if (f.openness <= FIST_MAX) {
      if (fistAnchor.current === null) fistAnchor.current = f.palmX;
      const dev = f.palmX - fistAnchor.current;
      if (Math.abs(dev) > FIST_DEVIATE && now - lastNav.current > NAV_COOLDOWN) {
        lastNav.current = now;
        fistAnchor.current = f.palmX; // re-anchor so a further slide flips again
        navigate(dev < 0 ? 1 : -1); // fist slides left → next page
      }
    } else {
      // half-open — neither mode
      fistAnchor.current = null;
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
        setStatus("Open palm & twist to scroll · fist + slide to change page");
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
