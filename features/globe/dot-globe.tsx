"use client";

import { useEffect, useRef } from "react";

/**
 * Orthographic dot-matrix globe rendered on a 2D canvas — no WebGL, no deps.
 * Landmasses are rasterised from simplified coastline polygons onto an
 * equal-area lat/lon lattice, then rotated and projected every frame.
 */

type LonLat = [number, number];

const RAD = Math.PI / 180;

/** Simplified coastlines. Coarse on purpose — they're sampled to dots. */
const LAND: LonLat[][] = [
  // North America
  [[-168, 66], [-165, 60], [-158, 57], [-152, 58], [-148, 60], [-140, 60], [-135, 57], [-130, 52], [-125, 48], [-124, 42], [-121, 35], [-117, 32], [-114, 30], [-110, 24], [-105, 20], [-97, 16], [-92, 15], [-88, 16], [-87, 21], [-90, 25], [-94, 29], [-97, 28], [-93, 30], [-89, 29], [-85, 30], [-82, 25], [-80, 27], [-81, 32], [-76, 35], [-70, 42], [-67, 45], [-60, 47], [-55, 52], [-57, 55], [-64, 60], [-68, 63], [-78, 63], [-85, 66], [-95, 68], [-105, 69], [-115, 70], [-125, 70], [-133, 69], [-141, 70], [-155, 71], [-165, 68]],
  // Greenland
  [[-45, 60], [-42, 63], [-38, 66], [-30, 68], [-22, 70], [-20, 73], [-22, 77], [-30, 82], [-42, 83], [-55, 82], [-62, 78], [-58, 72], [-52, 66], [-48, 61]],
  // South America
  [[-81, 0], [-78, 6], [-75, 9], [-70, 11], [-63, 11], [-60, 8], [-52, 5], [-50, 0], [-44, -2], [-38, -5], [-35, -8], [-38, -13], [-39, -18], [-45, -23], [-48, -25], [-53, -33], [-58, -35], [-62, -39], [-65, -45], [-68, -50], [-70, -54], [-74, -52], [-73, -45], [-73, -38], [-71, -30], [-70, -23], [-71, -18], [-76, -14], [-79, -8], [-81, -4]],
  // Africa
  [[-17, 14], [-16, 20], [-13, 25], [-10, 28], [-6, 32], [0, 35], [9, 37], [11, 33], [19, 31], [25, 32], [32, 31], [35, 28], [37, 22], [39, 15], [43, 12], [48, 12], [51, 11], [45, 5], [42, -1], [40, -10], [40, -16], [35, -20], [33, -26], [31, -30], [27, -34], [20, -35], [18, -32], [15, -27], [13, -20], [12, -12], [9, -1], [6, 4], [0, 5], [-5, 5], [-10, 8], [-14, 11]],
  // Europe
  [[-10, 36], [-9, 39], [-9, 43], [-4, 44], [-2, 47], [1, 49], [3, 52], [5, 53], [8, 54], [9, 57], [11, 58], [13, 55], [19, 55], [21, 57], [24, 59], [27, 60], [30, 62], [26, 66], [24, 69], [31, 70], [40, 68], [45, 66], [55, 68], [60, 67], [58, 60], [55, 55], [48, 50], [40, 46], [38, 44], [35, 42], [30, 45], [28, 41], [26, 40], [23, 38], [20, 40], [16, 42], [12, 38], [15, 37], [12, 44], [8, 44], [4, 43], [0, 40], [-6, 37]],
  // Asia
  [[45, 42], [50, 45], [52, 50], [58, 55], [60, 62], [65, 68], [70, 72], [78, 73], [90, 76], [100, 77], [110, 76], [120, 73], [130, 71], [140, 72], [150, 70], [160, 68], [170, 67], [178, 66], [170, 60], [162, 58], [155, 52], [145, 45], [140, 42], [135, 38], [130, 35], [126, 33], [122, 30], [120, 25], [117, 22], [110, 20], [107, 15], [105, 10], [102, 5], [100, 3], [98, 8], [95, 15], [92, 21], [88, 21], [85, 20], [82, 17], [80, 13], [77, 8], [73, 17], [70, 22], [65, 25], [60, 25], [56, 24], [52, 28], [48, 30], [45, 33], [43, 38]],
  // Australia
  [[114, -22], [113, -26], [115, -33], [118, -35], [123, -34], [129, -32], [134, -33], [137, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [151, -24], [147, -19], [143, -14], [141, -12], [136, -12], [132, -11], [130, -12], [126, -14], [122, -17], [117, -20]],
  // British Isles
  [[-6, 50], [-5, 54], [-3, 58], [0, 58], [1, 53], [1, 51]],
  // Japan
  [[130, 31], [132, 34], [136, 35], [140, 38], [142, 41], [145, 44], [142, 45], [139, 40], [136, 36], [133, 33]],
  // Madagascar
  [[43, -12], [50, -15], [50, -20], [47, -25], [44, -22], [43, -16]],
  // New Zealand
  [[166, -46], [170, -45], [174, -41], [177, -38], [175, -36], [172, -40], [168, -44]],
  // Sumatra / Java / Borneo
  [[95, 5], [105, 0], [115, -2], [119, -4], [117, -8], [110, -8], [100, -2]],
  // New Guinea
  [[131, -1], [141, -3], [147, -6], [150, -9], [143, -9], [136, -5]],
  // Philippines
  [[120, 6], [124, 10], [126, 14], [122, 18], [120, 14], [119, 10]],
  // Iceland
  [[-24, 64], [-14, 64], [-14, 66], [-22, 66]],
];

function pointInPoly(lon: number, lat: number, poly: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isLand(lon: number, lat: number): boolean {
  if (lat < -62) return true; // Antarctica, as a cap
  for (const poly of LAND) if (pointInPoly(lon, lat, poly)) return true;
  return false;
}

interface Vec3 { x: number; y: number; z: number }

function toVec3(lon: number, lat: number): Vec3 {
  const la = lat * RAD;
  const lo = lon * RAD;
  return { x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo) };
}

/** Build the land lattice once — equal-area so dots stay evenly spaced. */
function buildLandPoints(stepDeg: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let lat = -88; lat <= 88; lat += stepDeg) {
    const ring = Math.cos(lat * RAD);
    const count = Math.max(4, Math.round((360 / stepDeg) * ring));
    for (let i = 0; i < count; i++) {
      const lon = -180 + (360 * i) / count;
      if (isLand(lon, lat)) pts.push(toVec3(lon, lat));
    }
  }
  return pts;
}

export interface GlobeMarker { lon: number; lat: number; label: string; hot?: boolean }
export interface GlobeArc { from: [number, number]; to: [number, number]; hot?: boolean }

export interface DotGlobeProps {
  markers?: GlobeMarker[];
  arcs?: GlobeArc[];
  /** Degrees per second of spin. */
  speed?: number;
  className?: string;
  dotColor?: string;
  arcColor?: string;
  hotColor?: string;
  /** Pause spinning while the user drags to inspect. */
  interactive?: boolean;
}

const DEFAULT_MARKERS: GlobeMarker[] = [
  { lon: 72.87, lat: 19.07, label: "MUMBAI", hot: true },
  { lon: -74.0, lat: 40.71, label: "NEW YORK", hot: true },
  { lon: -0.13, lat: 51.51, label: "LONDON" },
  { lon: 139.69, lat: 35.69, label: "TOKYO" },
  { lon: 103.82, lat: 1.35, label: "SINGAPORE" },
  { lon: 8.68, lat: 50.11, label: "FRANKFURT" },
  { lon: 114.17, lat: 22.32, label: "HONG KONG" },
  { lon: 55.27, lat: 25.2, label: "DUBAI" },
];

const DEFAULT_ARCS: GlobeArc[] = [
  { from: [72.87, 19.07], to: [-74.0, 40.71], hot: true },
  { from: [72.87, 19.07], to: [-0.13, 51.51] },
  { from: [72.87, 19.07], to: [103.82, 1.35], hot: true },
  { from: [-74.0, 40.71], to: [-0.13, 51.51] },
  { from: [139.69, 35.69], to: [-74.0, 40.71] },
  { from: [114.17, 22.32], to: [8.68, 50.11] },
  { from: [55.27, 25.2], to: [72.87, 19.07] },
  { from: [103.82, 1.35], to: [139.69, 35.69] },
];

/** Spherical interpolation between two surface points, lifted into an arc. */
function arcPoints(from: [number, number], to: [number, number], steps = 56): Vec3[] {
  const a = toVec3(from[0], from[1]);
  const b = toVec3(to[0], to[1]);
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  const out: Vec3[] = [];
  // arc height scales with distance so short hops stay flat
  const lift = 0.12 + (omega / Math.PI) * 0.28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let x: number, y: number, z: number;
    if (sinOmega < 1e-6) {
      x = a.x; y = a.y; z = a.z;
    } else {
      const s1 = Math.sin((1 - t) * omega) / sinOmega;
      const s2 = Math.sin(t * omega) / sinOmega;
      x = a.x * s1 + b.x * s2; y = a.y * s1 + b.y * s2; z = a.z * s1 + b.z * s2;
    }
    const r = 1 + Math.sin(Math.PI * t) * lift;
    out.push({ x: x * r, y: y * r, z: z * r });
  }
  return out;
}

export function DotGlobe({
  markers = DEFAULT_MARKERS,
  arcs = DEFAULT_ARCS,
  speed = 6,
  className,
  dotColor = "255,255,255",
  arcColor = "245,158,11",
  hotColor = "94,207,214",
  interactive = true,
}: DotGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landRef = useRef<Vec3[] | null>(null);
  const rotRef = useRef(0);
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 });
  // positive tilt lifts the north pole toward the viewer — the familiar view
  const tiltRef = useRef(18);

  // build the land lattice once
  if (landRef.current === null) landRef.current = buildLandPoints(1.35);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let W = 0, H = 0, R = 0, cx = 0, cy = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      W = rect.width; H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      R = Math.min(W, H) * 0.41;
      cx = W / 2; cy = H / 2;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    /** Rotate a unit-sphere point by the current spin + tilt, then project. */
    const project = (v: Vec3) => {
      const ry = rotRef.current * RAD;
      const rx = tiltRef.current * RAD;
      // spin about Y
      const x1 = v.x * Math.cos(ry) + v.z * Math.sin(ry);
      const z1 = -v.x * Math.sin(ry) + v.z * Math.cos(ry);
      // tilt about X
      const y2 = v.y * Math.cos(rx) - z1 * Math.sin(rx);
      const z2 = v.y * Math.sin(rx) + z1 * Math.cos(rx);
      return { sx: cx + x1 * R, sy: cy - y2 * R, z: z2 };
    };

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!dragRef.current.active) rotRef.current = (rotRef.current + speed * dt) % 360;

      ctx.clearRect(0, 0, W, H);

      // ── limb glow + disc ──────────────────────────────────────────
      const glow = ctx.createRadialGradient(cx, cy, R * 0.75, cx, cy, R * 1.12);
      glow.addColorStop(0, `rgba(${dotColor},0.05)`);
      glow.addColorStop(1, `rgba(${dotColor},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2); ctx.fill();

      // outer HUD ring + ticks
      ctx.strokeStyle = `rgba(${dotColor},0.14)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2); ctx.stroke();
      for (let a = 0; a < 360; a += 6) {
        const long = a % 30 === 0;
        const r0 = R * 1.06;
        const r1 = r0 + (long ? 8 : 4);
        const rad = a * RAD;
        ctx.strokeStyle = `rgba(${dotColor},${long ? 0.35 : 0.15})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(rad) * r0, cy + Math.sin(rad) * r0);
        ctx.lineTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
        ctx.stroke();
      }

      // ── graticule ─────────────────────────────────────────────────
      ctx.strokeStyle = `rgba(${dotColor},0.07)`;
      ctx.lineWidth = 1;
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 3) {
          const p = project(toVec3(lon, lat));
          if (p.z > 0) { if (!started) { ctx.moveTo(p.sx, p.sy); started = true; } else ctx.lineTo(p.sx, p.sy); }
          else started = false;
        }
        ctx.stroke();
      }
      for (let lon = -180; lon < 180; lon += 30) {
        ctx.beginPath();
        let started = false;
        for (let lat = -85; lat <= 85; lat += 3) {
          const p = project(toVec3(lon, lat));
          if (p.z > 0) { if (!started) { ctx.moveTo(p.sx, p.sy); started = true; } else ctx.lineTo(p.sx, p.sy); }
          else started = false;
        }
        ctx.stroke();
      }

      // ── land dots ─────────────────────────────────────────────────
      const land = landRef.current ?? [];
      for (const v of land) {
        const p = project(v);
        if (p.z <= 0.02) continue;
        // fade toward the limb so the sphere reads as curved
        const a = 0.24 + p.z * 0.76;
        const size = p.z > 0.7 ? 1.6 : 1.2;
        ctx.fillStyle = `rgba(${dotColor},${a.toFixed(3)})`;
        ctx.fillRect(p.sx - size / 2, p.sy - size / 2, size, size);
      }

      // ── arcs ──────────────────────────────────────────────────────
      const tPulse = (now / 2600) % 1;
      for (let i = 0; i < arcs.length; i++) {
        const arc = arcs[i];
        const pts = arcPoints(arc.from, arc.to);
        const col = arc.hot ? hotColor : arcColor;
        ctx.lineWidth = arc.hot ? 1.6 : 1.2;

        // draw only the visible span
        ctx.beginPath();
        let started = false;
        for (const v of pts) {
          const p = project(v);
          if (p.z > -0.15) { if (!started) { ctx.moveTo(p.sx, p.sy); started = true; } else ctx.lineTo(p.sx, p.sy); }
          else started = false;
        }
        ctx.strokeStyle = `rgba(${col},0.5)`;
        ctx.stroke();

        // travelling pulse, staggered per arc
        const tp = (tPulse + i / arcs.length) % 1;
        const idx = Math.floor(tp * (pts.length - 1));
        const pp = project(pts[idx]);
        if (pp.z > -0.1) {
          ctx.fillStyle = `rgba(${col},0.95)`;
          ctx.beginPath(); ctx.arc(pp.sx, pp.sy, 2.1, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(${col},0.22)`;
          ctx.beginPath(); ctx.arc(pp.sx, pp.sy, 5.5, 0, Math.PI * 2); ctx.fill();
        }
      }

      // ── markers ───────────────────────────────────────────────────
      const ring = (now / 1500) % 1;
      for (const m of markers) {
        const p = project(toVec3(m.lon, m.lat));
        if (p.z <= 0.02) continue;
        const col = m.hot ? hotColor : arcColor;
        ctx.fillStyle = `rgba(${col},${(0.55 + p.z * 0.45).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 2.4, 0, Math.PI * 2); ctx.fill();
        // expanding ping
        ctx.strokeStyle = `rgba(${col},${(0.35 * (1 - ring) * p.z).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 3 + ring * 12, 0, Math.PI * 2); ctx.stroke();

        if (p.z > 0.35) {
          ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
          ctx.fillStyle = `rgba(${dotColor},${(0.3 + p.z * 0.5).toFixed(3)})`;
          ctx.fillText(m.label, p.sx + 7, p.sy + 3);
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    // drag to spin / tilt
    const onDown = (e: PointerEvent) => {
      if (!interactive) return;
      dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      rotRef.current += (e.clientX - dragRef.current.lastX) * 0.4;
      tiltRef.current = Math.max(-70, Math.min(70, tiltRef.current - (e.clientY - dragRef.current.lastY) * 0.3));
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      dragRef.current.active = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [markers, arcs, speed, dotColor, arcColor, hotColor, interactive]);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", height: "100%", display: "block", touchAction: "none", cursor: interactive ? "grab" : "default" }} />;
}
