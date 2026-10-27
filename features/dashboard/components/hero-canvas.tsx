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
    const accent = v("--accent-2", "#b0b0b0");

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

      /*
       * The day, written out.
       *
       * These were 2px ticks with a dot: they said an event existed and
       * nothing else — not what it was, not how much of the day was left
       * around it. In the widest element on the screen that is a waste of
       * the only part anybody looks at.
       *
       * Now each one is a labelled marker, and because labels at 09:00
       * and 09:30 would overlap at this scale they stagger across two
       * lanes. Two is enough for a normal day and the test is cheap: if
       * the previous label's right edge has not cleared this one's left
       * edge, drop a lane.
       */
      const evs = (evRef.current ?? [])
        .filter((e) => !e.allDay)
        .map((e) => ({ e, d: new Date(e.start) }))
        .filter((r) => !Number.isNaN(r.d.getTime()) && r.d.toDateString() === now.toDateString())
        .sort((a, b) => a.d.getTime() - b.d.getTime());

      const evTop = axisY - 46;
      const laneH = 17;
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "left";
      const lastRight = [-Infinity, -Infinity];

      for (const { e, d } of evs) {
        const hr = hoursInto(d);
        const px = Math.round(x(hr));
        const label = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")} ${e.summary}`;
        const wName = ctx.measureText(label).width;

        /* First lane whose last label has cleared this x, else lane 0 and
           accept the collision — a dropped event is worse than a tight one. */
        let lane = 0;
        for (let i = 0; i < lastRight.length; i++) {
          if (px > lastRight[i] + 8) { lane = i; break; }
          lane = i === lastRight.length - 1 ? 0 : lane;
        }
        /* A label drawn leftward occupies up to its stem, not past it. */
        lastRight[lane] = px + 4 + wName <= pad + inner ? px + wName : px;

        const y = evTop + lane * laneH;
        const past = hr < t;

        /* A stem down to the axis, so the label is tied to its hour rather
           than floating near it. */
        ctx.globalAlpha = past ? 0.42 : 1;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 0.5, y + 3);
        ctx.lineTo(px + 0.5, axisY - 2);
        ctx.stroke();

        ctx.fillStyle = accent;
        ctx.fillRect(px - 1.5, y + 1, 3, 3);

        ctx.fillStyle = past ? v("--ink-4", "rgba(242,242,242,.4)") : ink;
        /*
         * Late events read leftward.
         *
         * Everything after about 19:00 has no room to its right, and
         * clipping to fit turned "18:00 Boxing (HIIT)" into "18:00…" —
         * the one part of the evening he would actually look for. When
         * the label does not fit to the right of its stem it is drawn to
         * the left of it instead, which costs nothing and keeps the
         * stem, still, exactly on the hour.
         */
        const right = pad + inner;
        const fitsRight = px + 4 + wName <= right;
        if (fitsRight) {
          ctx.textAlign = "left";
          ctx.fillText(label, px + 4, y + 7);
        } else {
          ctx.textAlign = "right";
          /* Only clip if it does not fit in EITHER direction, which on a
             1800px axis means a title nobody could have read anyway. */
          let shown = label;
          const room = Math.max(0, px - 4 - pad);
          if (wName > room) {
            while (shown.length > 4 && ctx.measureText(shown + "…").width > room) {
              shown = shown.slice(0, -1);
            }
            shown += "…";
          }
          ctx.fillText(shown, px - 4, y + 7);
          ctx.textAlign = "left";
        }
        ctx.globalAlpha = 1;
      }

      /*
       * The longest clear stretch left today.
       *
       * The brief keeps telling him he has "a single 4.5-hour afternoon
       * window", which is a fact about this exact axis that the axis was
       * not showing. Measured between the end of one event and the start
       * of the next — SAGE's calendar rows carry no end time, so an event
       * is treated as occupying the hour it starts, which is honest about
       * being an approximation and still right about where the gap is.
       */
      const edges: number[] = [Math.max(t, 0)];
      for (const { d } of evs) {
        const hr = hoursInto(d);
        if (hr + 1 > t) { edges.push(hr); edges.push(hr + 1); }
      }
      edges.push(24);
      let gap = { from: 0, to: 0 };
      for (let i = 0; i < edges.length - 1; i += 1) {
        const from = edges[i], to = edges[i + 1];
        if (to - from > gap.to - gap.from) gap = { from, to };
      }
      if (gap.to - gap.from >= 1.5) {
        const gx0 = x(gap.from), gx1 = x(gap.to);
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.05;
        ctx.fillRect(gx0, evTop - 8, gx1 - gx0, laneH * 2 + 14);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = line;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(gx0 + 0.5, evTop - 8);
        ctx.lineTo(gx0 + 0.5, evTop + laneH * 2 + 6);
        ctx.moveTo(gx1 - 0.5, evTop - 8);
        ctx.lineTo(gx1 - 0.5, evTop + laneH * 2 + 6);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = v("--ink-4", "rgba(242,242,242,.4)");
        ctx.font = "8px ui-monospace, monospace";
        ctx.textAlign = "center";
        const hrs = gap.to - gap.from;
        ctx.fillText(
          `${hrs >= 10 ? hrs.toFixed(0) : hrs.toFixed(1)}H CLEAR`,
          (gx0 + gx1) / 2, evTop - 11,
        );
        ctx.textAlign = "left";
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
