"use client";

/**
 * Today, by the clock.
 *
 * The wall counted events — "0 today" — which is the same half-answer the
 * unread count was giving: it tells you whether the day is busy and nothing
 * about when you have to be somewhere.
 *
 * Events come from the server render, so this costs no request on load; it
 * refreshes itself every ten minutes because a calendar changes under you.
 * The next thing up is marked, because on a day with eight entries the one
 * you want is always the next one.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pane, Empty } from "@/components/pane";
import { shareJson } from "@/lib/share";
import { asArray } from "@/lib/as-array";
import { TZ } from "@/lib/config";
import type { EventRow } from "./command-view";

const hhmm = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
};

/** Fractional hours past local midnight, or null if the date will not parse. */
function hoursOf(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  return h + m / 60;
}

export function AgendaPanel({ n, events }: { n?: number; events: EventRow[] | null }) {
  const [rows, setRows] = useState<EventRow[] | null>(events);

  useEffect(() => {
    const load = () => {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(); to.setHours(23, 59, 59, 999);
      /*
       * `data.events`, not `data`.
       *
       * /api/calendar answers { data: { events, feeds, lead } }. I read the
       * first level as the array, so asArray received an object, returned
       * nothing, and the panel then *overwrote* the correct events the server
       * had already handed it as a prop — it showed "nothing on the calendar
       * today" on a day with entries, and the empty state was the panel
       * arguing with itself.
       *
       * Second time I have made this exact mistake: /api/feeds answers
       * { data: { source, items } } and I read `data` there too. The guard
       * test below now covers the class rather than the instance.
       */
      shareJson<{ data?: { events?: unknown } }>(`/api/calendar?from=${from.toISOString()}&to=${to.toISOString()}`)
        .then((j) => {
          const next = asArray<EventRow>(j?.data?.events);
          // Only replace what is on screen with something real. A failed or
          // empty refresh must not blank a good server render.
          if (next.length || rows === null) setRows(next);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 600_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * A vertical timeline, not a horizontal one.
   *
   * The first attempt put the hours along the x-axis with each entry at its
   * hour — which is the textbook shape and unusable in a pane this narrow.
   * "Compiler design lab" at 15:00 wants 150px of label starting 60% of the
   * way across a 600px column, so it either overflows the pane or gets
   * clipped to "Compiler d". Zeroing the offset to fix the clipping left a
   * list with a ruler on top of it: a timeline that had stopped being one.
   *
   * Vertically there is as much room as the pane is tall, labels run the
   * full width, and the gaps between entries are still proportional — which
   * is the whole reason to draw a timeline instead of a list. You can see
   * the free two hours after lunch.
   *
   * The axis fits the day's span rather than running 00:00–24:00: three
   * entries between 10 and 16 on a full-day axis occupy a quarter of it and
   * leave eighteen hours blank.
   */
  const timed = (rows ?? []).filter((e) => !e.allDay);
  const allDay = (rows ?? []).filter((e) => e.allDay);
  const nowH = hoursOf(new Date().toISOString()) ?? 0;

  const laid = useMemo(() => {
    const pts = timed
      .map((e) => ({ e, h: hoursOf(e.start) }))
      .filter((x): x is { e: EventRow; h: number } => x.h !== null)
      .sort((a, b) => a.h - b.h);
    if (!pts.length) return null;

    const lo = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.h), nowH)) - 1);
    const hi = Math.min(24, Math.ceil(Math.max(...pts.map((p) => p.h), nowH)) + 1);
    const span = Math.max(2, hi - lo);
    /* 26px a row is the floor for a readable line; the track is whichever is
       larger, the proportional height or enough room for every entry. */
    const ROW = 26;
    const height = Math.max(span * 17, pts.length * ROW + 10);
    const at = (h: number) => ((h - lo) / span) * height;

    /* One pass downward so two entries twenty minutes apart do not sit on
       top of each other. Proportional where there is room, stacked where
       there is not — the alternative is an overlap that hides an entry. */
    let last = -Infinity;
    const placed = pts.map(({ e, h }) => {
      const y = Math.max(at(h), last + ROW);
      last = y;
      return { e, h, y };
    });
    const needed = Math.max(height, last + ROW);
    return { lo, hi, span, height: needed, at, placed };
  }, [timed, nowH]);

  return (
    <Pane
      n={n}
      title="Agenda"
      status={rows?.length ? `${rows.length} today` : "clear"}
      live={!!rows?.length}
    >
      {rows === null && <div className="tile-wait">READING…</div>}
      {rows?.length === 0 && (
        <Empty reason="Nothing on the calendar today" action="Open calendar" href="/calendar" />
      )}

      {laid && (
        <div className="tlv" style={{ height: `${laid.height + 14}px` }}>
          {/* The hour rail. A tick every hour, a label every third when the
              span is long enough that every hour would be clutter. */}
          {Array.from({ length: laid.hi - laid.lo + 1 }, (_, i) => laid.lo + i)
            .filter((h) => (laid.span > 9 ? h % 3 === 0 : true))
            .map((h) => (
              <span className="tlv-h" key={h} style={{ top: `${laid.at(h)}px` }} aria-hidden>
                <i />{String(h).padStart(2, "0")}
              </span>
            ))}

          {/* Now. */}
          {nowH >= laid.lo && nowH <= laid.hi && (
            <span className="tlv-now" style={{ top: `${laid.at(nowH)}px` }} aria-hidden />
          )}

          {laid.placed.map(({ e, y }, i) => {
            const past = new Date(e.start).getTime() < Date.now();
            return (
              <Link
                className={`tlv-ev${past ? " past" : ""}${i === laid.placed.findIndex((q) => new Date(q.e.start).getTime() >= Date.now()) ? " next" : ""}`}
                key={e.id ?? i}
                href="/calendar"
                style={{ top: `${y}px` }}
                title={`${hhmm(e.start)} · ${e.summary}`}
              >
                <span className="tlv-dot" aria-hidden />
                <span className="tlv-t num">{hhmm(e.start)}</span>
                <span className="tlv-s">{e.summary || "(untitled)"}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* All-day entries have no position on a clock, so they are a list
          under the timeline rather than a block spanning the whole axis —
          a bar across the full width says "all day" and also says nothing. */}
      {allDay.map((e, i) => (
        <Link className="ag-row allday" key={e.id ?? `ad${i}`} href="/calendar">
          <span className="ag-when num">ALL</span>
          <span className="ag-what">{e.summary || "(untitled)"}</span>
        </Link>
      ))}
    </Pane>
  );
}
