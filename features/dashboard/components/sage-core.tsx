"use client";

import { useEffect, useRef } from "react";

/**
 * The Core — SAGE's central identity element. A monochrome instrument:
 * rotating tick rings, segmented arcs, breathing center. Canvas-rendered,
 * 60fps, zero assets. Click engages voice (handled by parent).
 */
export function SageCore({ size = 380 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const center = size / 2;
    let frame = 0;
    let raf = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ring = (radius: number, ticks: number, tickLength: number, rotation: number, alpha: number, width = 1) => {
      ctx.strokeStyle = `rgba(240,240,240,${alpha})`;
      ctx.lineWidth = width;
      for (let i = 0; i < ticks; i++) {
        const angle = (i / ticks) * Math.PI * 2 + rotation;
        ctx.beginPath();
        ctx.moveTo(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius);
        ctx.lineTo(
          center + Math.cos(angle) * (radius - tickLength),
          center + Math.sin(angle) * (radius - tickLength),
        );
        ctx.stroke();
      }
    };

    const arc = (radius: number, start: number, sweep: number, alpha: number, width = 1) => {
      ctx.strokeStyle = `rgba(240,240,240,${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(center, center, radius, start, start + sweep);
      ctx.stroke();
    };

    const draw = () => {
      const t = frame / 60;
      ctx.clearRect(0, 0, size, size);

      const r = size / 2;
      // outer fine tick ring (slow clockwise)
      ring(r - 8, 120, 5, t * 0.03, 0.35);
      // mid tick ring (counter-rotating, sparser, longer)
      ring(r - 26, 48, 10, -t * 0.06, 0.5);
      // segmented arcs (instrument bezel)
      for (let i = 0; i < 3; i++) {
        arc(r - 44, t * 0.18 + (i * Math.PI * 2) / 3, Math.PI / 2.4, 0.6, 1.5);
      }
      for (let i = 0; i < 5; i++) {
        arc(r - 58, -t * 0.11 + (i * Math.PI * 2) / 5, Math.PI / 5, 0.3);
      }
      // inner dotted orbit
      ctx.setLineDash([1, 7]);
      arc(r - 76, t * 0.05, Math.PI * 2, 0.35);
      ctx.setLineDash([]);

      // breathing center
      const breath = reduced ? 1 : 1 + Math.sin(t * 1.6) * 0.05;
      const coreR = (r - 108) * breath;
      const gradient = ctx.createRadialGradient(center, center, coreR * 0.2, center, center, coreR);
      gradient.addColorStop(0, "rgba(255,255,255,0.95)");
      gradient.addColorStop(0.55, "rgba(255,255,255,0.12)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center, center, coreR, 0, Math.PI * 2);
      ctx.fill();
      // core outline
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(center, center, coreR * 0.45, 0, Math.PI * 2);
      ctx.stroke();

      frame += 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="select-none"
      aria-label="SAGE core"
    />
  );
}
