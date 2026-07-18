"use client";

import { useEffect, useRef } from "react";

export interface CoreData {
  /** Hours-of-day (0-23, fractional ok) with calendar events — drawn as day-dial markers. */
  eventHours: number[];
  /** 0..1 — how loaded the day is (open tasks vs capacity) — inner arc fill. */
  load: number;
}

/**
 * The Core v2 — SAGE's living centerpiece.
 * Data-mapped: outer dial = 24h day with event markers + now-hand;
 * inner arc = task load. State-reactive: listens to `sage:voice-state`
 * (idle/listening/thinking/speaking) and changes tempo/intensity.
 */
export function SageCore({ size = 380, data }: { size?: number; data?: CoreData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<CoreData | undefined>(data);
  dataRef.current = data;

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
    let mode: "idle" | "listening" | "thinking" | "speaking" = "idle";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onVoiceState = (e: Event) => {
      const s = (e as CustomEvent).detail as string;
      mode = s === "listening" ? "listening" : s === "thinking" ? "thinking" : s === "speaking" ? "speaking" : "idle";
    };
    window.addEventListener("sage:voice-state", onVoiceState);

    const ring = (radius: number, ticks: number, tickLength: number, rotation: number, alpha: number, width = 1) => {
      ctx.strokeStyle = `rgba(240,240,240,${alpha})`;
      ctx.lineWidth = width;
      for (let i = 0; i < ticks; i++) {
        const angle = (i / ticks) * Math.PI * 2 + rotation;
        ctx.beginPath();
        ctx.moveTo(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius);
        ctx.lineTo(center + Math.cos(angle) * (radius - tickLength), center + Math.sin(angle) * (radius - tickLength));
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

    /** Map hour (0-24) to dial angle: midnight at top, clockwise. */
    const hourAngle = (h: number) => (h / 24) * Math.PI * 2 - Math.PI / 2;

    const draw = () => {
      const t = frame / 60;
      const speed = mode === "thinking" ? 4 : mode === "listening" ? 1.8 : mode === "speaking" ? 1.2 : 1;
      const glow = mode === "idle" ? 1 : 1.25;
      ctx.clearRect(0, 0, size, size);

      const r = size / 2;
      const d = dataRef.current;

      // ── 24h day dial (outermost): hour ticks, event markers, now-hand
      ring(r - 8, 96, 4, 0, 0.22);
      ring(r - 8, 24, 8, 0, 0.4); // hour marks
      if (d) {
        for (const h of d.eventHours) {
          const a = hourAngle(h);
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.beginPath();
          ctx.arc(center + Math.cos(a) * (r - 12), center + Math.sin(a) * (r - 12), 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      {
        const now = new Date();
        const a = hourAngle(now.getHours() + now.getMinutes() / 60);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(center + Math.cos(a) * (r - 4), center + Math.sin(a) * (r - 4));
        ctx.lineTo(center + Math.cos(a) * (r - 22), center + Math.sin(a) * (r - 22));
        ctx.stroke();
      }

      // ── rotating instrument rings
      ring(r - 30, 48, 9, -t * 0.06 * speed, 0.45);
      for (let i = 0; i < 3; i++) arc(r - 46, t * 0.18 * speed + (i * Math.PI * 2) / 3, Math.PI / 2.4, 0.55, 1.5);
      for (let i = 0; i < 5; i++) arc(r - 58, -t * 0.11 * speed + (i * Math.PI * 2) / 5, Math.PI / 5, 0.3);

      // ── task-load arc (inner instrument): sweep = load
      if (d) {
        arc(r - 72, -Math.PI / 2, Math.PI * 2, 0.12, 3);
        arc(r - 72, -Math.PI / 2, Math.PI * 2 * Math.min(d.load, 1), 0.85, 3);
      }

      ctx.setLineDash([1, 7]);
      arc(r - 84, t * 0.05 * speed, Math.PI * 2, 0.3);
      ctx.setLineDash([]);

      // ── breathing / speaking core
      const wobble =
        mode === "speaking"
          ? Math.sin(t * 14) * 0.06 + Math.sin(t * 23) * 0.04
          : Math.sin(t * 1.6) * 0.05;
      const breath = reduced ? 1 : 1 + wobble;
      const coreR = (r - 112) * breath;
      const gradient = ctx.createRadialGradient(center, center, coreR * 0.2, center, center, coreR);
      gradient.addColorStop(0, `rgba(255,255,255,${0.95 * glow > 1 ? 1 : 0.95 * glow})`);
      gradient.addColorStop(0.55, `rgba(255,255,255,${0.12 * glow})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center, center, coreR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(center, center, coreR * 0.45, 0, Math.PI * 2);
      ctx.stroke();

      frame += 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("sage:voice-state", onVoiceState);
    };
  }, [size]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} className="select-none" aria-label="SAGE core" />;
}
