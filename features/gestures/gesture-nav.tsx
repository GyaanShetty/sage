"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Hand } from "lucide-react";
import { useShellStore } from "@/features/shell/store";
import { HandController, type HandFrame } from "./hands";
import { PAGES } from "@/features/shell/components/pages";

/**
 * Page order for swipe navigation, taken from the nav itself.
 *
 * This was a hand-written list of twelve paths, which went wrong in both
 * directions: it named /lab and /forge (now removed), and it omitted /mail,
 * /calendar, /read and half the app — and `navigate()` no-ops when the current
 * path is missing, so gestures silently did nothing on those pages. PAGES is
 * already the single source of truth for navigation; one list cannot drift
 * from itself.
 */
const ROUTES = PAGES.map((p) => p.href);

const FIST_MAX = 1.15;        // closed fist → page-change mode
const DRAG_GAIN = 1.5;        // page travel relative to hand travel (1 = 1:1)
const FIST_DEVIATE = 0.16;    // how far a fist must slide sideways to flip a page
const NAV_COOLDOWN = 1100;

/** A pose must persist this long to count. Fingers pass through shaka and OK
 *  shapes incidentally on the way to other poses; without this, simply opening
 *  your hand fires the wheel. */
const POSE_HOLD_MS = 260;
/** Ignore a re-trigger of the same pose for this long. */
const POSE_COOLDOWN = 800;

/* ── Sliding the wheel ──────────────────────────────────────────────────────
 * Two motions have now been tried and discarded. Wrist roll ran out of range
 * in under a right angle. Pinch-and-circle worked on paper but asks the hand
 * to hold a precise pinch *and* trace an arc at the same time — two fine-motor
 * tasks at once, which is what made it feel awful.
 *
 * So: one motion, no pose. With the wheel up, move your hand sideways and the
 * dial follows. Nothing to hold, nothing to trace, and the direction maps to
 * the thing you can see turning.
 */
/** Fraction of frame width per detent. About six pages across a comfortable
 *  arm movement, so the whole wheel is two easy sweeps. */
const SLIDE_PER_STEP = 0.075;
/** Movement below this per frame is tremor, not intent. */
const SLIDE_DEADZONE = 0.004;

/**
 * Hands-free gesture control (opt-in).
 *
 * The wheel:  🤙 raises it · slide your hand sideways to turn the dial ·
 * 👌 opens what is in the selector · ✊ dismisses it. Nothing else closes it —
 * not a dropped hand, not a pause, not tracking blinking out.
 *
 * Elsewhere:  pinch and move up/down to drag the page like a touchscreen;
 * fist and slide sideways to flip between pages.
 *
 * Uses the same MediaPipe tracker as the Forge, lazy-loaded only when enabled.
 * A small camera preview + status chip show while it is live; everything
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
  /** Where the hand was when the current detent began. */
  const slideAnchor = useRef<number | null>(null);
  const poseSince = useRef<{ pose: string; at: number } | null>(null);
  const lastPose = useRef(0);

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

  const resetSlide = () => { slideAnchor.current = null; };

  const closeWheel = useCallback(() => {
    if (!wheelOpen.current) return;
    wheelOpen.current = false;
    resetSlide();
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
      // Tracking drops out constantly — a blink of lost hand must not dismiss
      // the wheel; only ✊ does. The slide re-anchors, though, so a reappearing
      // hand does not jump the dial by the distance it was not seen moving.
      resetSlide();
      return;
    }
    const now = performance.now();

    // ---- 🤙 SHAKA → raise the wheel ----
    // Open and close are deliberately different gestures: one pose that
    // toggles means the outcome depends on state you cannot see, so the same
    // hand shape sometimes summons and sometimes dismisses.
    if (!wheelOpen.current && held("shaka", f.shaka, now)) {
      wheelOpen.current = true;
      resetSlide();
      window.dispatchEvent(new CustomEvent("sage:nav-open"));
      return;
    }

    // ---- while the wheel is up ----
    if (wheelOpen.current) {
      // ✊ dismisses without choosing. Distinct from 🤙, and deliberate enough
      // that a relaxed hand will not trip it.
      if (held("fist", f.openness <= FIST_MAX && !f.shaka, now)) {
        closeWheel();
        return;
      }
      // 👌 accepts whatever is in the selector.
      if (held("ok", f.ok, now)) {
        wheelOpen.current = false;
        resetSlide();
        window.dispatchEvent(new CustomEvent("sage:nav-select"));
        return;
      }

      // Slide the hand sideways to turn the dial. No pose to hold: the wheel
      // is already up, so the hand's only job is to point at a page.
      if (slideAnchor.current === null) { slideAnchor.current = f.palmX; return; }
      const dx = f.palmX - slideAnchor.current;
      if (Math.abs(dx) < SLIDE_DEADZONE) return;
      const steps = Math.trunc(dx / SLIDE_PER_STEP);
      if (steps !== 0) {
        slideAnchor.current += steps * SLIDE_PER_STEP;  // carry the remainder
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

  /** Latest onFrame, without making the camera depend on it. */
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus("Loading vision model…");
    // The controller gets a stable wrapper that reads the latest handler,
    // so the camera survives re-renders while still calling current code.
    const c = new HandController((f) => frameRef.current(f));
    (async () => {
      try {
        await c.start(videoRef.current!);
        if (cancelled) { c.stop(); return; }
        ctrl.current = c;
        setStatus("🤙 wheel · slide to turn · 👌 open · ✊ dismiss");
      } catch (err) {
        setStatus(
          /denied|NotAllowed/i.test(String(err))
            ? "Camera blocked — allow access to use gestures."
            : "Couldn't start gesture control on this device.",
        );
        /**
         * Deliberately NOT setGestureNav(false).
         *
         * Auto-disabling on failure is why this reads as "gesture control does
         * not work" rather than "gesture control is broken": the switch flips
         * itself back, so there is nothing left turned on to inspect and the
         * status message disappears with the component. The error stays on
         * screen now and the toggle stays where he put it.
         */
      }
    })();
    return () => {
      cancelled = true;
      c.stop();
      ctrl.current = null;
      setDir(null);
    };
    // `onFrame` deliberately absent: it is a useCallback over navigate and
    // closeWheel, so including it tore the camera down and restarted it on
    // every unrelated re-render. Held in a ref instead — the same fix
    // lib/live.ts already applies to its load function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="gn-wrap">
      {/* autoPlay matters: the controller calls video.play(), but without the
          attribute some browsers never start producing frames, so the hand
          model waits forever on a stream that is technically "playing". */}
      <video ref={videoRef} autoPlay muted playsInline className="gn-cam" />
      <div className="gn-chip">
        <Hand className="size-3.5" />
        <span>{status}</span>
      </div>
      {dir && <div className={`gn-arrow ${dir}`}>{dir === "up" ? "▲" : "▼"}</div>}
    </div>
  );
}
