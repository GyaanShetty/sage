"use client";

/**
 * The month, as a shape.
 *
 * The agenda already lists today hour by hour, so a second list of the
 * same events would be a second thing to read. What the agenda cannot
 * show is the SHAPE around today — that Thursday is stacked and the
 * weekend is empty — and that is the only reason to spend rail height on
 * a month grid.
 *
 * So the cells carry load, not titles: a dot for a day with something, a
 * brighter dot for a day with several. Today is the one cell with a box
 * around it. Clicking a day opens the full calendar on it, because the
 * moment you want detail this grid is the wrong tool and should get out
 * of the way.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pane } from "@/components/pane";
import type { EventRow } from "./command-view";

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

const key = (d: Date) =>
  `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;

export function MiniCalendar({ n, events }: { n?: number; events: EventRow[] | null }) {
  /* The month on display, as an offset from this one. State rather than a
     date so that "today" stays correct across midnight without the view
     jumping. */
  const [offset, setOffset] = useState(0);

  const today = new Date();
  /* Memoised on the offset, not rebuilt each render: a fresh Date here is a
     fresh dependency, which made the 42-cell grid below recompute on every
     keystroke anywhere in the console. The month only changes when the
     offset does. */
  const view = useMemo(
    () => new Date(new Date().getFullYear(), new Date().getMonth() + offset, 1),
    [offset],
  );

  /* How many events fall on each day. Counting once here rather than
     filtering inside the cell loop: 42 cells × every event is the kind of
     quadratic nobody notices until the calendar has a year in it. */
  const load = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events ?? []) {
      const d = new Date(e.start);
      if (Number.isNaN(d.getTime())) continue;
      const k = key(d);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [events]);

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    /* Monday-first: getDay() is Sunday-first, so Sunday (0) becomes 6. */
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(start.getDate() - lead);

    const out: { d: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      out.push({ d, inMonth: d.getMonth() === view.getMonth() });
    }
    /* Drop a trailing all-next-month week rather than always drawing six:
       a month that fits in five weeks should not leave a blank row. */
    return out.slice(0, out.slice(35).every((c) => !c.inMonth) ? 35 : 42);
  }, [view]);

  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" })
    .format(view).toUpperCase();
  const todayK = key(today);

  return (
    <Pane
      n={n}
      title="Calendar"
      status={
        <span className="mc-nav">
          <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous month">‹</button>
          <b>{monthLabel}</b>
          <button onClick={() => setOffset((o) => o + 1)} aria-label="Next month">›</button>
        </span>
      }
    >
      <div className="mc">
        <div className="mc-dow" aria-hidden>
          {DOW.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="mc-grid">
          {cells.map(({ d, inMonth }) => {
            const k = key(d);
            const count = load.get(k) ?? 0;
            return (
              <Link
                href={`/calendar?day=${k}`}
                key={k}
                className={[
                  "mc-cell",
                  inMonth ? "" : "out",
                  k === todayK ? "now" : "",
                  count > 0 ? "has" : "",
                  count > 2 ? "busy" : "",
                ].filter(Boolean).join(" ")}
                title={count ? `${k} · ${count} event${count === 1 ? "" : "s"}` : k}
              >
                <span className="mc-n">{d.getDate()}</span>
                {count > 0 && <i className="mc-dot" aria-hidden />}
              </Link>
            );
          })}
        </div>
      </div>
    </Pane>
  );
}
