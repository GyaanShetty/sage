"use client";

/**
 * The board.
 *
 * TickTick already had a band on the wall — a flat list, sorted by
 * whatever order the API returned. A list answers "what is on my plate";
 * it does not answer the question you actually open a board for, which is
 * "what is late, and what is today". So the only real decision here is the
 * columns, and they are by WHEN rather than by project or by status:
 *
 *   LATE · TODAY · THIS WEEK · LATER
 *
 * Project is a chip on the card, because you filter by project maybe once
 * a week and you ask "what is late" every morning. A board whose columns
 * are projects makes the common question require reading all of them.
 *
 * LATE is the only column allowed the accent. If nothing is late the
 * column still renders, empty and grey — a board that hides its worst
 * column teaches you not to trust the absence of bad news.
 */

import { useCallback, useMemo, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { Pane } from "@/components/pane";
import { asArray } from "@/lib/as-array";
import { useLive, notifyDataChanged } from "@/lib/live";
import { sound } from "@/lib/sound";
import "../task-board.css";

interface TickTask {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  dueDate?: string;
  priority: number;
  status: number;
}

type Lane = "late" | "today" | "week" | "later";

const LANES: { id: Lane; label: string }[] = [
  { id: "late",  label: "Late" },
  { id: "today", label: "Today" },
  { id: "week",  label: "This week" },
  { id: "later", label: "Later" },
];

/* TickTick's priority scale is 0/1/3/5. Only the top two earn a mark —
   flagging three levels out of four is the same as flagging none. */
const pri = (p: number) => (p >= 5 ? "HIGH" : p >= 3 ? "MED" : "");

const hhmm = (d: Date) =>
  `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;

/**
 * Which lane a task falls in.
 *
 * Day boundaries, not 24-hour windows: something due at 23:00 tonight is
 * TODAY, and at 00:30 tomorrow it is LATE — which is how a person reads
 * their own day, and not what `now - due < 86400000` would say.
 */
function laneOf(t: TickTask, now: Date): Lane {
  if (!t.dueDate) return "later";
  const due = new Date(t.dueDate);
  if (Number.isNaN(due.getTime())) return "later";

  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday); startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const endOfWeek = new Date(startOfToday); endOfWeek.setDate(endOfWeek.getDate() + 7);

  if (due < startOfToday) return "late";
  if (due < startOfTomorrow) return "today";
  if (due < endOfWeek) return "week";
  return "later";
}

export function TaskBoard({ n }: { n?: number }) {
  /*
   * Three states, not two.
   *
   * `null` is still loading; `"off"` is TickTick not connected. Collapsing
   * those into an empty array gives four empty columns that read as "you
   * have nothing to do" when the truth is "SAGE cannot see your tasks" —
   * the most reassuring possible way to be wrong.
   */
  const [tasks, setTasks] = useState<TickTask[] | null | "off">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch("/api/ticktick")
      .then((r) => r.json())
      /* The route answers `{ ok: true, data: null }` when there is no
         token — a successful request reporting an absent integration. */
      .then((j) => setTasks(j?.data == null ? "off" : asArray<TickTask>(j.data)))
      .catch(() => setTasks("off"));
  }, []);

  useLive(load, { everyMs: 120_000, scopes: ["tasks"] });

  /*
   * Optimistic, with the row put back on failure.
   *
   * Ticking something off and watching it sit there for a second is the
   * difference between a board that feels like an instrument and one that
   * feels like a web page. But an optimistic update that cannot fail
   * visibly is a lie, so a refused complete restores the card and says so.
   */
  const complete = async (t: TickTask) => {
    setBusy(t.id);
    const before = tasks;
    setTasks((cur) => (Array.isArray(cur) ? cur : []).filter((x) => x.id !== t.id));
    sound.latch(true);
    const res = await fetch("/api/ticktick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: t.projectId, taskId: t.id }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setTasks(before);
      setErr("TickTick refused that — it may already be gone.");
      return;
    }
    notifyDataChanged("tasks");
  };

  const remove = async (t: TickTask) => {
    setBusy(t.id);
    const before = tasks;
    setTasks((cur) => (Array.isArray(cur) ? cur : []).filter((x) => x.id !== t.id));
    const res = await fetch(
      `/api/ticktick?projectId=${encodeURIComponent(t.projectId)}&taskId=${encodeURIComponent(t.id)}`,
      { method: "DELETE" },
    ).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setTasks(before);
      setErr("TickTick wouldn't delete that.");
      return;
    }
    notifyDataChanged("tasks");
  };

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setAdding(true);
    setErr(null);
    const res = await fetch("/api/ticktick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => null);
    setAdding(false);
    if (!res?.ok) {
      const msg = await res?.json().then((j) => j.error).catch(() => null);
      setErr(msg ?? "Couldn't reach TickTick.");
      return;
    }
    setDraft("");
    await load();
    notifyDataChanged("tasks");
  };

  const now = new Date();
  const open = (Array.isArray(tasks) ? tasks : []).filter((t) => t.status === 0);

  /*
   * The fortnight ahead, as a histogram.
   *
   * Four lanes tell you what is late and what is today; they cannot tell
   * you that Thursday has six things on it and the rest of the week is
   * empty. That is the question a board is actually for — where the
   * pile-up is — and it is one bar chart. Undated work is deliberately
   * absent from it rather than dumped on today: it has no date, and
   * inventing one is how a planning view starts lying.
   */
  const ahead = useMemo(() => {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i);
      return { d, n: 0, hi: 0 };
    });
    for (const t of open) {
      if (!t.dueDate) continue;
      const due = new Date(t.dueDate);
      if (Number.isNaN(due.getTime())) continue;
      const idx = Math.floor((due.setHours(0, 0, 0, 0) - start.getTime()) / 86_400_000);
      if (idx < 0 || idx >= 14) continue;
      days[idx].n++;
      if (t.priority >= 5) days[idx].hi++;
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const aheadPeak = Math.max(1, ...ahead.map((d) => d.n));
  const undated = open.filter((t) => !t.dueDate).length;
  const byLane = (lane: Lane) =>
    open
      .filter((t) => laneOf(t, now) === lane)
      /* Inside a lane, soonest first, and undated last — the only ordering
         that does not make you read the whole column to find the next thing. */
      .sort((a, b) => {
        const av = a.dueDate ? Date.parse(a.dueDate) : Infinity;
        const bv = b.dueDate ? Date.parse(b.dueDate) : Infinity;
        if (av !== bv) return av - bv;
        return b.priority - a.priority;
      });

  const late = byLane("late").length;

  return (
    <Pane
      n={n}
      title="Board"
      status={tasks === "off" ? "NOT CONNECTED" : tasks === null ? "SYNCING" : late > 0 ? `${late} LATE` : `${open.length} OPEN`}
      live={late > 0}
    >
      <div className="brd">
        <div className="brd-add">
          <input
            className="brd-in"
            placeholder="Add a task…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            aria-label="New task"
            disabled={tasks === "off"}
          />
          <button className="brd-plus" onClick={add} disabled={adding || !draft.trim()} aria-label="Add task">
            {adding ? <Loader2 className="size-3 brd-spin" /> : <Plus className="size-3" />}
          </button>
          {err && <span className="brd-err" role="status">{err}</span>}
        </div>

        {/* Where the pile-up is. Stacked: the darker part of each bar is
            the high-priority share, so a tall bar that is mostly dim reads
            differently from a short one that is all urgent. */}
        <div className="brd-ahead" role="img"
             aria-label={`Tasks due over the next fortnight, peak ${aheadPeak} on one day`}>
          {ahead.map((d, i) => (
            <span
              className={`brd-ab${i === 0 ? " today" : ""}${d.n ? " on" : ""}`}
              key={i}
              title={`${d.d.toDateString()} · ${d.n} due${d.hi ? `, ${d.hi} high` : ""}`}
            >
              <i className="brd-ab-stack" style={{ height: `${(d.n / aheadPeak) * 100}%` }}>
                {d.hi > 0 && <b style={{ height: `${(d.hi / Math.max(d.n, 1)) * 100}%` }} />}
              </i>
              <u>{d.d.getDate()}</u>
            </span>
          ))}
          <span className="brd-ahead-k">
            14d{undated > 0 && <em> · {undated} undated</em>}
          </span>
        </div>

        <div className="brd-lanes">
          {LANES.map((lane) => {
            const items = byLane(lane.id);
            return (
              <section className={`brd-lane${lane.id === "late" && items.length ? " hot" : ""}`} key={lane.id}>
                <header className="brd-lane-hd">
                  <span className="brd-lane-t">{lane.label}</span>
                  <span className="brd-lane-n">{items.length.toString().padStart(2, "0")}</span>
                </header>
                <div className="brd-cards">
                  {tasks === null && <p className="brd-quiet">Syncing…</p>}
                  {tasks === "off" && lane.id === "late" && (
                    <p className="brd-quiet">
                      TickTick isn&rsquo;t connected ·{" "}
                      <a className="brd-link" href="/settings">Connect</a>
                    </p>
                  )}
                  {Array.isArray(tasks) && items.length === 0 && (
                    <p className="brd-quiet">{lane.id === "late" ? "Nothing late" : "Empty"}</p>
                  )}
                  {items.map((t) => {
                    const due = t.dueDate ? new Date(t.dueDate) : null;
                    return (
                      <article className={`brd-card${busy === t.id ? " busy" : ""}`} key={t.id}>
                        <button
                          className="brd-tick"
                          onClick={() => complete(t)}
                          aria-label={`Complete ${t.title}`}
                          title="Complete"
                        ><Check className="size-3" /></button>
                        <div className="brd-body">
                          <p className="brd-t">{t.title}</p>
                          <div className="brd-meta">
                            <span className="brd-proj">{t.projectName}</span>
                            {due && <span className="brd-due num">{hhmm(due)}</span>}
                            {pri(t.priority) && (
                              <span className={`brd-pri${t.priority >= 5 ? " hi" : ""}`}>{pri(t.priority)}</span>
                            )}
                          </div>
                        </div>
                        {/* Deleting and completing are different intentions: a
                            task added by mistake should not have to be ticked
                            off as though it were done. */}
                        <button
                          className="brd-x"
                          onClick={() => remove(t)}
                          aria-label={`Delete ${t.title}`}
                          title="Delete"
                        ><X className="size-3" /></button>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </Pane>
  );
}
