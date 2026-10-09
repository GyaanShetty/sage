"use client";

/**
 * The hero, drawn on a canvas.
 *
 * Gyaan asked for a canvas in the dashboard, and the question that decides
 * whether a canvas is worth having is what it draws. A decorative one is a
 * screensaver taking the best position on the page; this draws the one thing
 * the wall could not show anywhere else — the whole day as a single shape.
 *
 * Twenty-four hours left to right. The market sessions he actually trades
 * around are bands underneath; his calendar events are blocks above; the
 * hour ticks are the axis; and a marker rides the current time. One glance
 * answers "how much of today is gone, what is left in it, and is anything
 * open right now" — three questions that previously needed three panes.
 *
 * Canvas rather than SVG because this redraws every second and is a hundred
 * or so marks: at that rate SVG is a hundred DOM nodes being reflowed, and
 * canvas is one. It is also the honest use of the element — immediate-mode
 * drawing of something that changes — rather than canvas as a texture.
 *
 * Accessibility: the canvas is `aria-hidden` and everything it says is also
 * in the DOM beside it — the counts, the dateline, and a text summary of the
 * next event. A canvas is pixels to a screen reader, so nothing may live
 * only inside it.
 */

import { useEffect, useRef } from "react";
import { TZ } from "@/lib/config";
import type { EventRow } from "./command-view";

/* Sessions in IST, which is the clock he is on. Opening and closing bells
   rather than "morning/afternoon": the point is when something is live. */
const SESSIONS: { label: string; from: number; to: number; slot: string }[] = [
  { label: "NSE", from: 9.25, to: 15.5, slot: "--s1" },
  { label: "LSE", from: 13.5, to: 21.5, slot: "--s2" },
  { label: "NYSE", from: 19, to: 25.5, slot: "--s4" },
];

/** Hours since local midnight, fractional. */
function hoursInto(d: Date): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  return h + m / 60;
}

export function HeroCanvas({ events }: { events: EventRow[] | null }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  /* The events are read through a ref so the draw loop is not re-armed every
     time the calendar refreshes — re-arming a rAF loop on every prop change
     is how these end up running several times over. */
  const evRef = useRef<EventRow[] | null>(events);
  evRef.current = events;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;

    const ink = v("--ink", "#f2f2f2");
    const line = v("--line-2", "rgba(242,242,242,.24)");
    const amber = v("--amber", "#e8a33d");

    let w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    /* Size the backing store to device pixels and the element to CSS pixels,
       or every line is a soft two-pixel smear on a retina screen. */
    const size = () => {
      const r = cv.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const now = new Date();
      const t = hoursInto(now);
      const pad = 18;
      const inner = Math.max(1, w - pad * 2);
      const x = (hour: number) => pad + (Math.min(24, Math.max(0, hour)) / 24) * inner;

      const axisY = Math.round(h * 0.62) + 0.5;
      const bandH = 7;
      const bandTop = axisY + 12;

      ctx.clearRect(0, 0, w, h);

      /* The axis, and a tick each hour with a label every three. Recessive:
         the axis is the thing you read against, never the thing you read. */
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, axisY);
      ctx.lineTo(pad + inner, axisY);
      ctx.stroke();

      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      for (let hr = 0; hr <= 24; hr += 1) {
        const px = Math.round(x(hr)) + 0.5;
        const major = hr % 3 === 0;
        ctx.strokeStyle = line;
        ctx.beginPath();
        ctx.moveTo(px, axisY);
        ctx.lineTo(px, axisY + (major ? 5 : 2.5));
        ctx.stroke();
        if (major && hr < 24) {
          ctx.fillStyle = v("--ink-4", "rgba(242,242,242,.4)");
          ctx.fillText(String(hr).padStart(2, "0"), px, axisY - 6);
        }
      }

      /* Market sessions, stacked under the axis. A 2px gap between bands is
         the surface showing through, which is what keeps two adjacent fills
         from reading as one shape. */
      SESSIONS.forEach((s, i) => {
        const y = bandTop + i * (bandH + 2);
        const live = t >= s.from && t < s.to;
        ctx.fillStyle = v(s.slot, ink);
        ctx.globalAlpha = live ? 1 : 0.34;
        const x0 = x(s.from), x1 = x(Math.min(24, s.to));
        ctx.fillRect(x0, y, Math.max(2, x1 - x0), bandH);
        /* A session crossing midnight continues at the left edge rather than
           being clipped — the day is a loop, not a line that stops. */
        if (s.to > 24) ctx.fillRect(x(0), y, Math.max(2, x(s.to - 24) - x(0)), bandH);
        ctx.globalAlpha = 1;

        ctx.fillStyle = live ? ink : v("--ink-4", "rgba(242,242,242,.4)");
        ctx.font = "8px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.fillText(s.label, x0 + 4, y + bandH - 1);
      });

      /* Calendar events above the axis. Timed events get a block at their
         hour; all-day events are skipped here because an all-day block would
         be the whole width and would say nothing about when. */
      const evs = (evRef.current ?? []).filter((e) => !e.allDay);
      const evTop = axisY - 34;
      for (const e of evs) {
        const d = new Date(e.start);
        if (Number.isNaN(d.getTime())) continue;
        if (d.toDateString() !== now.toDateString()) continue;
        const px = x(hoursInto(d));
        ctx.fillStyle = amber;
        ctx.fillRect(Math.round(px) - 1, evTop, 2, 22);
        ctx.beginPath();
        ctx.arc(Math.round(px), evTop, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      /* Now. The one mark that moves, and the only full-height one — it is
         the reading everything else is relative to. */
      const nx = Math.round(x(t)) + 0.5;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(nx, evTop - 10);
      ctx.lineTo(nx, bandTop + SESSIONS.length * (bandH + 2) + 2);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(nx - 4, evTop - 10);
      ctx.lineTo(nx + 4, evTop - 10);
      ctx.lineTo(nx, evTop - 5);
      ctx.closePath();
      ctx.fill();

      /* The part of the day already spent, as a hairline over the axis. */
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, axisY);
      ctx.lineTo(x(t), axisY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    size();
    draw();

    /* A second is the resolution of the fastest thing on here (the now
       marker moves one pixel a minute on a 1200px canvas), so a rAF loop
       would be sixty redraws for no visible change. Interval, and it stops
       entirely when the tab is hidden. */
    let timer: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (timer) clearInterval(timer);
      timer = document.hidden ? null : setInterval(draw, 1000);
    };
    arm();
    const onVis = () => { if (!document.hidden) draw(); arm(); };
    document.addEventListener("visibilitychange", onVis);

    const ro = new ResizeObserver(() => { size(); draw(); });
    ro.observe(cv);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="dh-canvas" aria-hidden />;
}
