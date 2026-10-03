"use client";

/**
 * What today is made of.
 *
 * Tasks, events and unread mail were three panels that each told you a number.
 * A number is not an answer — "4 open" does not tell you which four, and the
 * panel that says it is the one you then have to click. So this is one list of
 * actual things, ordered the way the day will hit you: what is overdue, what is
 * due today, what is on the calendar, then the inbox.
 *
 * Tasks come from the matrix endpoint, which already ranks them by urgency and
 * importance — so the order is the one SAGE already worked out rather than a
 * second opinion invented here.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { shareJson } from "@/lib/share";
import { asArray } from "@/lib/as-array";
import { TZ } from "@/lib/config";

interface Task { id: string; title: string; dueAt: string | null; hoursToDue: number | null }
interface Ev { title: string; start: string; allDay?: boolean }

const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso));

/** "overdue", "2h", "tomorrow" — a deadline you can act on without arithmetic. */
function when(t: Task): string {
  if (t.hoursToDue === null) return "";
  if (t.hoursToDue < 0) return "overdue";
  if (t.hoursToDue < 1) return "now";
  if (t.hoursToDue < 24) return `${Math.round(t.hoursToDue)}h`;
  const d = Math.round(t.hoursToDue / 24);
  return d === 1 ? "tomorrow" : `${d}d`;
}

export function Today() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    shareJson<{ data?: Record<string, Task[]> }>("/api/task/matrix")
      .then((j) => {
        const g = j?.data ?? {};
        // Do first, then schedule. Delegate and drop are deliberately not here:
        // this list is what you are going to do today, not an inventory.
        setTasks([...asArray<Task>(g.do), ...asArray<Task>(g.schedule)].slice(0, 7));
      })
      .catch(() => setTasks([]));

    const day = new Date();
    const from = new Date(day); from.setHours(0, 0, 0, 0);
    const to = new Date(day); to.setHours(23, 59, 59, 999);
    shareJson<{ data?: Ev[] }>(`/api/calendar?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((j) => setEvents(asArray<Ev>(j?.data)))
      .catch(() => setEvents([]));

    shareJson<{ data?: { messages?: unknown } }>("/api/mail?view=unread")
      .then((j) => setUnread(asArray(j?.data?.messages).length))
      .catch(() => setUnread(null));
  }, []);

  /* Optimistic: the row crosses out the moment you press it, because waiting
     for a round trip to acknowledge a checkbox is how a list feels broken. */
  const complete = async (id: string) => {
    setDone((d) => new Set(d).add(id));
    await fetch(`/api/task/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    }).catch(() => {
      setDone((d) => { const n = new Set(d); n.delete(id); return n; });
    });
  };

  const nothing = tasks?.length === 0 && events?.length === 0 && !unread;

  return (
    <section>
      <div className="sec-h">
        <h2>Today</h2>
        <Link href="/workspace">All tasks</Link>
      </div>

      {tasks === null && <p className="quiet">Loading…</p>}

      {nothing && <p className="quiet">Nothing scheduled and nothing overdue. The day is yours.</p>}

      <div className="rows">
        {tasks?.map((t) => (
          <button key={t.id} className="row" onClick={() => complete(t.id)} disabled={done.has(t.id)}>
            <span className={`tick${done.has(t.id) ? " on" : ""}`} aria-hidden>
              {done.has(t.id) && <Check className="size-3" strokeWidth={3} />}
            </span>
            <span className="row-main">
              <span className="row-t" style={done.has(t.id) ? { textDecoration: "line-through", opacity: 0.4 } : undefined}>
                {t.title}
              </span>
            </span>
            <span className={`row-v${t.hoursToDue !== null && t.hoursToDue < 0 ? " down" : ""}`}>{when(t)}</span>
          </button>
        ))}

        {events?.map((e, i) => (
          <div className="row" key={`ev-${i}`}>
            <span className="row-k num">{e.allDay ? "all day" : hhmm(e.start)}</span>
            <span className="row-main"><span className="row-t">{e.title}</span></span>
          </div>
        ))}

        {!!unread && (
          <Link className="row" href="/mail">
            <span className="row-main">
              <span className="row-t">{unread} unread</span>
              <span className="row-s">Inbox</span>
            </span>
          </Link>
        )}
      </div>
    </section>
  );
}
