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

export function AgendaPanel({ n, events }: { n?: number; events: EventRow[] | null }) {
  const [rows, setRows] = useState<EventRow[] | null>(events);

  useEffect(() => {
    const load = () => {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(); to.setHours(23, 59, 59, 999);
      shareJson<{ data?: unknown }>(`/api/calendar?from=${from.toISOString()}&to=${to.toISOString()}`)
        .then((j) => setRows(asArray<EventRow>(j?.data)))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 600_000);
    return () => clearInterval(id);
  }, []);

  /* The first entry that has not started yet. Everything before it is behind
     you, which is worth seeing but not worth the emphasis. */
  const nextIdx = useMemo(() => {
    if (!rows) return -1;
    const now = Date.now();
    return rows.findIndex((e) => new Date(e.start).getTime() >= now);
  }, [rows]);

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
      {rows?.map((e, i) => (
        <Link className={`ag-row${i === nextIdx ? " next" : ""}${i < nextIdx ? " past" : ""}`} key={e.id ?? i} href="/calendar">
          <span className="ag-when num">{hhmm(e.start)}</span>
          <span className="ag-what">{e.summary || "(untitled)"}</span>
          {i === nextIdx && <span className="ag-tag">NEXT</span>}
        </Link>
      ))}
    </Pane>
  );
}
