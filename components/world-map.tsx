"use client";

/**
 * The world, flat, with the links that mean something.
 *
 * Coastlines from the same generated point set the globe uses, projected
 * equirectangular — which distorts the poles badly and is exactly right here,
 * because this is a diagram of connections rather than a map you navigate by.
 *
 * The arcs are not decoration. They run from home to the cities SAGE already
 * tracks a clock for, and each one carries that city's current local time.
 * A world map with glowing lines between financial centres you have no
 * relationship with is a screensaver; this one answers "what time is it where
 * the people I deal with are".
 */

import { useEffect, useRef } from "react";
import { COAST } from "@/lib/coastline";

export interface Place { lat: number; lon: number; label: string; note?: string }

/** Equirectangular: lon/lat straight onto x/y. */
const proj = (lon: number, lat: number, w: number, h: number) => ({
  x: ((lon + 180) / 360) * w,
  y: ((90 - lat) / 180) * h,
});

export function WorldMap({
  home, places, className,
}: { home: Place; places: Place[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const data = useRef({ home, places });
  data.current = { home, places };

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let stop = false;
    let dpr = 1;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      ctx.clearRect(0, 0, w, h);

      // Land.
      ctx.fillStyle = "#6f757f";
      for (let i = 0; i < COAST.length; i += 2) {
        const p = proj(COAST[i], COAST[i + 1], w, h);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(p.x, p.y, 1 * dpr, 1 * dpr);
      }

      const tint = accent();
      const { home: hm, places: ps } = data.current;
      const H = proj(hm.lon, hm.lat, w, h);

      // Arcs. Bowed toward the top of the frame so two cities on the same
      // latitude do not draw a line straight through the label between them.
      for (const p of ps) {
        const P = proj(p.lon, p.lat, w, h);
        const mx = (H.x + P.x) / 2;
        const my = (H.y + P.y) / 2 - Math.abs(P.x - H.x) * 0.22 - 8 * dpr;
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = tint;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(H.x, H.y);
        ctx.quadraticCurveTo(mx, my, P.x, P.y);
        ctx.stroke();

        // A pulse running the arc, so the link reads as live. Position only —
        // nothing about the speed encodes anything, and it is not pretending
        // to.
        if (!still) {
          const k = ((t / 2600) + (p.lon + 180) / 360) % 1;
          const qx = (1 - k) * (1 - k) * H.x + 2 * (1 - k) * k * mx + k * k * P.x;
          const qy = (1 - k) * (1 - k) * H.y + 2 * (1 - k) * k * my + k * k * P.y;
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = tint;
          ctx.beginPath();
          ctx.arc(qx, qy, 1.6 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }

        // The city.
        ctx.globalAlpha = 1;
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(P.x, P.y, 2.2 * dpr, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#e6e9ef";
        ctx.font = `${8 * dpr}px ui-monospace, monospace`;
        ctx.textAlign = P.x > w * 0.82 ? "right" : "left";
        const dx = P.x > w * 0.82 ? -6 * dpr : 6 * dpr;
        ctx.fillText(p.label.toUpperCase(), P.x + dx, P.y - 4 * dpr);
        if (p.note) {
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = "#9aa0aa";
          ctx.fillText(p.note, P.x + dx, P.y + 7 * dpr);
        }
      }

      // Home, ringed so it is distinguishable from the places it links to.
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(H.x, H.y, 2.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.arc(H.x, H.y, 7 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#e6e9ef";
      ctx.font = `${8 * dpr}px ui-monospace, monospace`;
      ctx.textAlign = "left";
      ctx.fillText(hm.label.toUpperCase(), H.x + 9 * dpr, H.y + 3 * dpr);

      ctx.globalAlpha = 1;
      if (!still) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    const vis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!still) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", vis);

    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  return <canvas ref={ref} className={`wmap${className ? ` ${className}` : ""}`} aria-hidden />;
}
