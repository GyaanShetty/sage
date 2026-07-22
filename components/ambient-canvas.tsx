"use client";

import { useEffect, useRef } from "react";

/**
 * Atmosphere layer: a slow particle drift behind everything, occasional
 * shooting streak, plus a cursor spotlight (CSS vars consumed in globals).
 * One canvas, ~90 points, rAF-throttled — costs almost nothing.
 */
export function AmbientCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const N = 90;
    const pts = Array.from({ length: N }, () => ({
      x: Math.random() * 2000,
      y: Math.random() * 1400,
      z: 0.3 + Math.random() * 0.7, // depth → size/speed/alpha
      tw: Math.random() * Math.PI * 2,
    }));
    let streak: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
    let nextStreak = performance.now() + 6000 + Math.random() * 9000;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x -= 0.028 * p.z;
        p.y -= 0.014 * p.z;
        if (p.x < -4) p.x = w + 4;
        if (p.y < -4) p.y = h + 4;
        const twinkle = 0.5 + 0.5 * Math.sin(t / 1600 + p.tw);
        ctx.globalAlpha = 0.05 + 0.1 * p.z * twinkle;
        ctx.fillStyle = "#c8d4d6";
        const s = p.z * 1.4;
        ctx.fillRect(p.x % (w + 8), p.y % (h + 8), s, s);
      }
      // shooting streak
      if (!streak && t > nextStreak) {
        const fromLeft = Math.random() > 0.5;
        streak = {
          x: fromLeft ? -40 : Math.random() * w,
          y: fromLeft ? Math.random() * h * 0.5 : -40,
          vx: 7 + Math.random() * 5,
          vy: 2.4 + Math.random() * 2,
          life: 1,
        };
        nextStreak = t + 9000 + Math.random() * 14000;
      }
      if (streak) {
        streak.x += streak.vx;
        streak.y += streak.vy;
        streak.life -= 0.012;
        const grad = ctx.createLinearGradient(streak.x - streak.vx * 9, streak.y - streak.vy * 9, streak.x, streak.y);
        grad.addColorStop(0, "rgba(94,207,214,0)");
        grad.addColorStop(1, `rgba(94,207,214,${0.5 * streak.life})`);
        ctx.strokeStyle = grad;
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(streak.x - streak.vx * 9, streak.y - streak.vy * 9);
        ctx.lineTo(streak.x, streak.y);
        ctx.stroke();
        if (streak.life <= 0 || streak.x > w + 60 || streak.y > h + 60) streak = null;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // cursor spotlight → CSS vars
    let pending = false;
    const onMove = (e: PointerEvent) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--spot-x", `${e.clientX}px`);
        document.documentElement.style.setProperty("--spot-y", `${e.clientY}px`);
        pending = false;
      });
    };
    window.addEventListener("pointermove", onMove);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <canvas ref={ref} className="ambient-canvas" aria-hidden />;
}
