"use client";

/**
 * The hero globe.
 *
 * Real geometry, not an image: points laid on a sphere by latitude and
 * longitude, rotated about the polar axis and projected orthographically.
 * Front-facing points only, brightness falling off with depth, and a marker
 * at a real coordinate that goes round the back with everything else.
 *
 * Deliberately a graticule rather than continents. Drawing coastlines would
 * mean shipping a land mask, and faking them with noise would put invented
 * geography on the screen — a grid is honest about being a grid, and at this
 * size reads as a globe regardless.
 */

import { useEffect, useRef } from "react";

const LAT_STEP = 6;   // degrees between parallels
const LON_STEP = 6;   // degrees between meridians
/* Radians per millisecond. 2π/0.00013 is 48 seconds a turn — slow enough to
   read as drift rather than spin, fast enough that the marker comes back
   round while you are still looking at the screen. (An earlier comment here
   claimed thirteen hours, which is simply the arithmetic done wrong.) */
const SPIN = 0.00013;

type Pt = { x: number; y: number; z: number };

function sphere(): Pt[] {
  const pts: Pt[] = [];
  for (let lat = -80; lat <= 80; lat += LAT_STEP) {
    const phi = (lat * Math.PI) / 180;
    // Fewer points near the poles, so the density stays even rather than
    // bunching into two bright caps.
    const ring = Math.max(6, Math.round((360 / LON_STEP) * Math.cos(phi)));
    for (let i = 0; i < ring; i++) {
      const theta = (i / ring) * Math.PI * 2;
      pts.push({
        x: Math.cos(phi) * Math.cos(theta),
        y: Math.sin(phi),
        z: Math.cos(phi) * Math.sin(theta),
      });
    }
  }
  return pts;
}

/** A lat/lon in the same space as the dots, so markers ride the same sphere. */
function at(latDeg: number, lonDeg: number): Pt {
  const phi = (latDeg * Math.PI) / 180;
  const theta = (lonDeg * Math.PI) / 180;
  return { x: Math.cos(phi) * Math.cos(theta), y: Math.sin(phi), z: Math.cos(phi) * Math.sin(theta) };
}

export function Globe({
  className, marks = [{ lat: 12.9352, lon: 77.6245, label: "BENGALURU" }],
}: {
  className?: string;
  marks?: { lat: number; lon: number; label?: string }[];
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const pts = sphere();
    const marked = marks.map((m) => ({ ...at(m.lat, m.lon), label: m.label }));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let stop = false;
    let dpr = 1;

    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);

    const accent = () =>
      getComputedStyle(document.body).getPropertyValue("--signal").trim() || "#f0a020";

    const draw = (t: number) => {
      if (stop) return;
      const w = cv.width, h = cv.height;
      const cx = w / 2, cy = h / 2;
      // The band is far wider than it is tall, so the sphere is sized by
      // height and allowed to run past it slightly — a globe cropped top and
      // bottom reads as one you are close to, which is the intent.
      const R = Math.min(w * 0.32, h * 0.62);
      const a = still ? 0.6 : t * SPIN;
      const cosA = Math.cos(a), sinA = Math.sin(a);

      ctx.clearRect(0, 0, w, h);

      for (const p of pts) {
        // Spin about Y, then take z toward the viewer.
        const x = p.x * cosA - p.z * sinA;
        const z = p.x * sinA + p.z * cosA;
        if (z < 0) continue;                       // back of the sphere
        const depth = z;                           // 0 at the limb, 1 facing us
        ctx.globalAlpha = 0.1 + depth * 0.6;
        ctx.fillStyle = "#d2d6de";
        const r = (0.6 + depth * 1.0) * dpr;
        ctx.beginPath();
        ctx.arc(cx + x * R, cy - p.y * R, r, 0, Math.PI * 2);
        ctx.fill();
      }

      const tint = accent();
      for (const m of marked) {
        const x = m.x * cosA - m.z * sinA;
        const z = m.x * sinA + m.z * cosA;
        if (z < 0) continue;
        const px = cx + x * R, py = cy - m.y * R;
        ctx.globalAlpha = 0.25 + z * 0.75;
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(px, py, 2.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = (0.12 + z * 0.25);
        ctx.beginPath();
        ctx.arc(px, py, 8 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = tint;
        ctx.lineWidth = dpr;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      if (!still) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    // A canvas painting behind a hidden tab is work nobody sees.
    const vis = () => {
      if (document.hidden) { cancelAnimationFrame(raf); }
      else if (!still) { raf = requestAnimationFrame(draw); }
    };
    document.addEventListener("visibilitychange", vis);

    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={ref} className={`globe${className ? ` ${className}` : ""}`} aria-hidden />;
}
