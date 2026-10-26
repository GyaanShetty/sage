"use client";

/**
 * What SAGE has been doing.
 *
 * Every producer, brief, archive and proposal writes a row to the Event
 * log, and until now none of it surfaced anywhere — so when SAGE did
 * something useful at 06:00 the only evidence was the result appearing
 * somewhere else. An assistant you cannot audit is one you end up
 * checking by hand, which defeats the point of it.
 *
 * Two readings, because they answer different questions:
 *
 *   · the BAND is twenty-four hours of activity by the hour, so "has it
 *     been running" is one glance rather than a scroll. This is the
 *     reading that matters while the heartbeat is still unconfigured —
 *     an empty band IS the answer;
 *   · the LIST is the last few things it actually did.
 */

import { useCallback, useMemo, useState } from "react";
import { Pane } from "@/components/pane";
import { asArray } from "@/lib/as-array";
import { useLive } from "@/lib/live";

interface Ev { id: string; type: string; payload: unknown; createdAt: string }

/*
 * Event types are dotted and machine-shaped — `agency.proposal`,
 * `brief.generated`. The first segment is the actor and the second is
 * what happened, which is all a human needs in a 300px rail.
 */
const say = (type: string) => {
  const [head, tail] = type.split(".");
  return { who: head ?? type, what: (tail ?? "").replace(/[-_]/g, " ") };
};

/** The one-line detail, if the payload carries something readable. */
const detailOf = (p: unknown): string | null => {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  for (const k of ["title", "summary", "text", "subject", "label", "name"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

const hhmm = (d: Date) =>
  `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;

export function ActivityTile({ n }: { n?: number }) {
  const [events, setEvents] = useState<Ev[] | null>(null);

  const load = useCallback(() =>
    fetch("/api/events/recent")
      .then((r) => r.json())
      .then((j) => setEvents(asArray<Ev>(j.data)))
      .catch(() => setEvents([])),
  []);

  useLive(load, { everyMs: 120_000 });

  /* Twenty-four buckets, oldest on the left, ending at the current hour —
     a rolling day rather than midnight-to-midnight, so the band never
     shows an empty morning just because it is 00:30. */
  const band = useMemo(() => {
    const now = new Date();
    const hours: { label: number; n: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(d.getHours() - i, 0, 0, 0);
      hours.push({ label: d.getHours(), n: 0 });
    }
    const first = new Date(now);
    first.setHours(first.getHours() - 23, 0, 0, 0);
    for (const e of events ?? []) {
      const t = new Date(e.createdAt);
      if (Number.isNaN(t.getTime()) || t < first) continue;
      const idx = Math.floor((t.getTime() - first.getTime()) / 3_600_000);
      if (idx >= 0 && idx < 24) hours[idx].n++;
    }
    return hours;
  }, [events]);

  const peak = Math.max(1, ...band.map((h) => h.n));
  const total = band.reduce((a, h) => a + h.n, 0);
  const rows = (events ?? []).slice(0, 7);

  return (
    <Pane
      n={n}
      title="Activity"
      status={events === null ? "READING" : `${total} IN 24H`}
      live={total > 0}
    >
      <div className="av">
        <div
          className="av-band"
          role="img"
          aria-label={`${total} events in the last 24 hours`}
        >
          {band.map((h, i) => (
            <span
              className={`av-h${h.n ? " on" : ""}`}
              key={i}
              title={`${h.label.toString().padStart(2, "0")}:00 · ${h.n} event${h.n === 1 ? "" : "s"}`}
            >
              {/* A floor of 1px so an empty hour is a drawn gap rather than
                  a missing mark — "nothing happened" is data too. */}
              <i style={{ height: `${h.n ? Math.max(12, (h.n / peak) * 100) : 1}%` }} />
            </span>
          ))}
        </div>
        <div className="av-scale">
          <span>24h ago</span><span>now</span>
        </div>

        {events !== null && rows.length === 0 && (
          <p className="av-quiet">Nothing logged — the clock isn&rsquo;t running</p>
        )}

        <ul className="av-list">
          {rows.map((e) => {
            const { who, what } = say(e.type);
            const detail = detailOf(e.payload);
            const t = new Date(e.createdAt);
            return (
              <li className="av-row" key={e.id}>
                <span className="av-t num">{Number.isNaN(t.getTime()) ? "--:--" : hhmm(t)}</span>
                <span className="av-who">{who}</span>
                <span className="av-what">{detail ?? what}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </Pane>
  );
}
