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

/** A pose must persist this long to count. Fingers pass through shaka and OK
 *  shapes incidentally on the way to other poses; without this, simply opening
 *  your hand fires the wheel. */
const POSE_HOLD_MS = 260;
/** Ignore a re-trigger of the same pose for this long. */
const POSE_COOLDOWN = 800;

/* ── Pinch-and-circle rotation ──────────────────────────────────────────────
 * Wrist roll turned out to be an uncomfortable way to drive a wheel: the
 * usable range is barely a right angle and holding a rotated wrist is tiring.
 * Winding a pinched hand in circles is the natural motion for a dial, and it
 * has no range limit — keep circling and the wheel keeps turning.
 *
 * The centre is the running mean of recent pinched positions rather than a
 * fixed anchor: a hand circling anywhere in frame produces points whose
 * centroid IS the centre of that circle, so the user never has to find a
 * particular spot to orbit.
 */
/** Radians swept per detent. A full circle is ~2π, so about twelve pages. */
const ANGLE_PER_STEP = 0.52;
/** Trail is bounded by distance travelled, not by sample count: the centre is
 *  fitted from a fixed length of arc however fast or slow the hand moves. A
 *  fixed count fails outright when circling slowly — the points bunch into a
 *  stub of arc that no centre can be recovered from. */
const ARC_LEN = 0.30;
const MIN_PTS = 6;
const MAX_PTS = 90;
/** Fitted radii outside this band are a bad fit, not a real circle. */
const MIN_R = 0.02;
const MAX_R = 0.60;

/**
 * Least-squares circle through the trail (Kåsa fit): solves
 * x² + y² = 2ax + 2by + c, giving centre (a, b) and r = √(c + a² + b²).
 *
 * The obvious approach — average the recent points and call that the centre —
 * is wrong for an arc: the centroid of a partial arc sits between the arc and
 * the true centre, which both under-reads the angle and collapses entirely
 * when the arc is short. Fitting recovers the centre from any decent arc.
 */
function fitCircle(pts: { x: number; y: number }[]): { cx: number; cy: number; r: number } | null {
  const n = pts.length;
  if (n < MIN_PTS) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y;
    sxy += p.x * p.y; sxz += p.x * z; syz += p.y * z; sz += z;
  }
  const A = [[2 * sxx, 2 * sxy, sx], [2 * sxy, 2 * syy, sy], [2 * sx, 2 * sy, n]];
  const b = [sxz, syz, sz];
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const det = det3(A);
  if (Math.abs(det) < 1e-12) return null;      // collinear points — no circle
  const solve = (col: number) => {
    const M = A.map((r) => r.slice());
    for (let i = 0; i < 3; i++) M[i][col] = b[i];
    return det3(M) / det;
  };
  const cx = solve(0), cy = solve(1), c = solve(2);
  const r2 = c + cx * cx + cy * cy;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  if (r < MIN_R || r > MAX_R) return null;
  return { cx, cy, r };
}

/**
 * Hands-free gesture control (opt-in).
 *
 * The wheel:  🤙 raises it, 🤙 again puts it away — nothing else closes it, not
 * a dropped hand, not a pause, not tracking blinking out. Pinch and wind in
 * circles to turn the dial, 👌 to open what is in the selector.
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
  /** Recent pinched positions; their centroid is the circle's centre. */
  const trail = useRef<{ x: number; y: number }[]>([]);
  const lastAngle = useRef<number | null>(null);
  const sweep = useRef(0);          // radians accumulated since the last detent
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

  const resetCircle = () => { trail.current = []; lastAngle.current = null; sweep.current = 0; };

  const closeWheel = useCallback(() => {
    if (!wheelOpen.current) return;
    wheelOpen.current = false;
    resetCircle();
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
      // the wheel. Only 🤙 closes it. The circle restarts, though, so a
      // reappearing hand does not jump the dial by the gap it missed.
      resetCircle();
      return;
    }
    const now = performance.now();

    // ---- 🤙 SHAKA → raise the wheel ----
    if (held("shaka", f.shaka, now)) {
      if (wheelOpen.current) { closeWheel(); }
      else {
        wheelOpen.current = true;
        resetCircle();
        window.dispatchEvent(new CustomEvent("sage:nav-open"));
      }
      return;
    }

    // ---- while the wheel is up: twist to rotate, 👌 to open ----
    if (wheelOpen.current) {
      // 👌 accepts whatever is in the selector.
      if (held("ok", f.ok, now)) {
        wheelOpen.current = false;
        resetCircle();
        window.dispatchEvent(new CustomEvent("sage:nav-select"));
        return;
      }

      // Pinch and wind in circles to turn the dial. Releasing the pinch simply
      // pauses — the wheel stays where it is until you circle again or 🤙.
      if (!f.pinch) { resetCircle(); return; }

      const pt = { x: f.palmX, y: f.palmY };
      const tr = trail.current;
      tr.push(pt);
      if (tr.length > MAX_PTS) tr.shift();
      // Trim from the front so the trail always spans about ARC_LEN of travel.
      let len = 0;
      for (let i = 1; i < tr.length; i++) len += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y);
      while (tr.length > MIN_PTS && len > ARC_LEN) {
        len -= Math.hypot(tr[1].x - tr[0].x, tr[1].y - tr[0].y);
        tr.shift();
      }

      const fit = fitCircle(tr);
      // Holding still, or moving in a straight line — not a dial gesture.
      if (!fit) { lastAngle.current = null; return; }

      const angle = Math.atan2(pt.y - fit.cy, pt.x - fit.cx);
      if (lastAngle.current === null) { lastAngle.current = angle; return; }

      let d = angle - lastAngle.current;
      // Unwrap across the ±π seam, or crossing it would read as a near-full
      // turn in the wrong direction.
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      lastAngle.current = angle;

      sweep.current += d;
      const steps = Math.trunc(sweep.current / ANGLE_PER_STEP);
      if (steps !== 0) {
        sweep.current -= steps * ANGLE_PER_STEP;   // carry the remainder
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
        setStatus("🤙 wheel · pinch & circle to turn · 👌 open · 🤙 again to close");
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
