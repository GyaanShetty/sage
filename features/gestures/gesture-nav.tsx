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

const FIST_MAX = 1.15;        // closed fist → page-change mode
const DRAG_GAIN = 1.5;        // page travel relative to hand travel (1 = 1:1)
const FIST_DEVIATE = 0.16;    // how far a fist must slide sideways to flip a page
const NAV_COOLDOWN = 1100;

/** Radians of palm twist per detent. A comfortable wrist rotation spans
 *  roughly a right angle, which at this size is about five pages. */
const ROLL_PER_STEP = 0.30;
/** A pose must persist this long to count. Fingers pass through shaka and OK
 *  shapes incidentally on the way to other poses; without this, simply opening
 *  your hand fires the wheel. */
const POSE_HOLD_MS = 260;
/** Ignore a re-trigger of the same pose for this long. */
const POSE_COOLDOWN = 800;
/** The wheel closes itself if nothing happens for this long — an interface you
 *  raised by accident should not stay up until you dismiss it. Twisting resets
 *  the clock, so deliberately browsing keeps it open indefinitely. */
const WHEEL_IDLE_MS = 6_000;
/** Hand dropped below this height (1 = bottom of frame) reads as "put it down". */
const HAND_DOWN_Y = 0.82;

/**
 * Hands-free gesture navigation (opt-in). Pinch (thumb + index) to grab the page
 * and move your hand up/down to drag it — like scrolling a touchscreen in the
 * air; unpinch to let go. Make a fist and slide it left/right to flip between
 * pages. Uses the same MediaPipe tracker as the Forge, lazy-loaded only when
 * enabled. A small camera preview + status chip show while it's live; everything
 * degrades to a friendly message on camera failure.
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

  const dragY = useRef<number | null>(null);   // last palmY while pinched
  const fistAnchor = useRef<number | null>(null);
  const lastNav = useRef(0);

  // Wheel state, kept in refs: this runs per video frame and must not re-render.
  const wheelOpen = useRef(false);
  const rollAnchor = useRef<number | null>(null);
  const poseSince = useRef<{ pose: string; at: number } | null>(null);
  const lastPose = useRef(0);
  const wheelTouched = useRef(0);   // last time the wheel saw deliberate input

  /** True once a pose has been held long enough and is off cooldown. */
  const held = (pose: string, active: boolean, now: number): boolean => {
    if (!active) {
      if (poseSince.current?.pose === pose) poseSince.current = null;
      return false;
    }
    if (poseSince.current?.pose !== pose) { poseSince.current = { pose, at: now }; return false; }
    if (now - poseSince.current.at < POSE_HOLD_MS) return false;
    if (now - lastPose.current < POSE_COOLDOWN) return false;
    lastPose.current = now;
    poseSince.current = null;
    return true;
  };

  const closeWheel = useCallback(() => {
    if (!wheelOpen.current) return;
    wheelOpen.current = false;
    rollAnchor.current = null;
    window.dispatchEvent(new CustomEvent("sage:nav-close"));
  }, []);

  const navigate = useCallback((delta: number) => {
    const i = ROUTES.findIndex((r) => pathRef.current.startsWith(r));
    const next = ROUTES[Math.min(ROUTES.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))];
    if (next && !pathRef.current.startsWith(next)) router.push(next);
  }, [router]);

  const scroller = () => (document.querySelector("main") as HTMLElement | null);

  const onFrame = useCallback((f: HandFrame | null) => {
    if (!f) {
      setDir(null); dragY.current = null; fistAnchor.current = null;
      poseSince.current = null;
      // Hand out of frame closes the wheel rather than leaving it stranded.
      closeWheel();
      return;
    }
    const now = performance.now();

    // ---- 🤙 SHAKA → raise the wheel ----
    if (held("shaka", f.shaka, now)) {
      if (wheelOpen.current) { closeWheel(); }
      else {
        wheelOpen.current = true;
        rollAnchor.current = f.roll;
        wheelTouched.current = now;
        window.dispatchEvent(new CustomEvent("sage:nav-open"));
      }
      return;
    }

    // ---- while the wheel is up: twist to rotate, 👌 to open ----
    if (wheelOpen.current) {
      // Lowering your hand dismisses it, the way you would drop a menu.
      if (f.palmY > HAND_DOWN_Y) { closeWheel(); return; }
      // Idle timeout, measured from the last twist rather than from opening.
      if (now - wheelTouched.current > WHEEL_IDLE_MS) { closeWheel(); return; }
      if (held("ok", f.ok, now)) {
        wheelOpen.current = false;
        rollAnchor.current = null;
        window.dispatchEvent(new CustomEvent("sage:nav-select"));
        return;
      }
      if (rollAnchor.current === null) rollAnchor.current = f.roll;
      // Unwrap across the ±π seam, or a twist past vertical would snap the
      // wheel the long way round.
      let d = f.roll - rollAnchor.current;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const steps = Math.trunc(d / ROLL_PER_STEP);
      if (steps !== 0) {
        rollAnchor.current += steps * ROLL_PER_STEP; // keep the remainder
        wheelTouched.current = now;                  // twisting keeps it alive
        window.dispatchEvent(new CustomEvent("sage:nav-rotate", { detail: { steps } }));
      }
      return; // the wheel owns the hand while it is up
    }

    // ---- PINCH → grab & drag the page (touchscreen-style) ----
    if (f.pinch) {
      fistAnchor.current = null;
      const el = scroller() ?? (document.scrollingElement as HTMLElement) ?? document.documentElement;
      const h = el?.clientHeight || window.innerHeight;
      if (dragY.current !== null && el) {
        const dy = f.palmY - dragY.current;          // + when hand moves down
        el.scrollBy({ top: -dy * h * DRAG_GAIN });   // pull page down → go up
        if (Math.abs(dy) > 0.002) setDir(dy > 0 ? "up" : "down");
      }
      dragY.current = f.palmY;
      return;
    }
    dragY.current = null;
    setDir(null);

    // ---- CLOSED FIST → slide left/right to change page ----
    if (f.openness <= FIST_MAX) {
      if (fistAnchor.current === null) fistAnchor.current = f.palmX;
      const dev = f.palmX - fistAnchor.current;
      if (Math.abs(dev) > FIST_DEVIATE && now - lastNav.current > NAV_COOLDOWN) {
        lastNav.current = now;
        fistAnchor.current = f.palmX; // re-anchor so a further slide flips again
        navigate(dev < 0 ? 1 : -1); // fist slides left → next page
      }
    } else {
      fistAnchor.current = null;
    }
  }, [navigate, closeWheel]);

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
        setStatus("🤙 wheel · twist to rotate · 👌 open · hand down to dismiss");
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
