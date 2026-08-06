"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2,
  MapPin, Plus, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "./calendar.css";

/**
 * The calendar, as a place rather than a panel.
 *
 * Events were creatable from a strip inside the dashboard and readable in the
 * brief, which covers "what is next" and nothing else. Neither answers "what
 * does the week after next look like", which is the question you ask before
 * agreeing to anything.
 *
 * Two things this is careful about:
 *
 *   - Days are his days. A month grid built from UTC puts events on the wrong
 *     square for everything before 05:30 IST, and a calendar that is wrong
 *     about which day something is on has no reason to exist.
 *   - Feed events are read-only, and look it. An .ics feed is somebody else's
 *     calendar; offering an edit button on a lecture the university publishes
 *     would be offering something that cannot work.
 */

interface Ev {
  id?: string;
  summary: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  /** Present only on events from a subscribed feed — the label of that feed. */
  feed?: string;
}
interface Feed { label: string; enabled: boolean; error: string | null }

const TZ = "Asia/Kolkata";
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** His calendar day for an instant — never the browser's, never UTC's. */
const dayOf = (iso: string) => DAY_KEY.format(new Date(iso));
const todayKey = () => DAY_KEY.format(new Date());

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/**
 * The squares of a month grid: whole weeks, Monday first.
 *
 * Built from a UTC-noon anchor per day so that adding days never lands on a
 * daylight-saving seam and silently repeats or skips a date.
 */
function monthGrid(year: number, month: number): { key: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1, 12));
  const startOffset = (first.getUTCDay() + 6) % 7;          // Monday = 0
  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() - startOffset);

  const cells: { key: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cursor.getUTCDate()).padStart(2, "0");
    cells.push({ key: `${y}-${m}-${d}`, inMonth: cursor.getUTCMonth() === month });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Six rows is always enough and never wrong, but a trailing week entirely
  // outside the month is just empty space.
  return cells.slice(0, cells.slice(35).every((c) => !c.inMonth) ? 35 : 42);
}

/** The seven day-keys of the week containing `key`, Monday first. */
function weekOf(key: string): string[] {
  const anchor = new Date(`${key}T12:00:00Z`);
  const offset = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - offset);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(anchor.toISOString().slice(0, 10));
    anchor.setUTCDate(anchor.getUTCDate() + 1);
  }
  return out;
}

/** Minutes since midnight, in his timezone — the y-axis of a week grid. */
function minutesInto(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Rows start here and end at DAY_END — nobody needs 3am on a timetable. */
const DAY_START = 7 * 60;
const DAY_END = 23 * 60;
const PX_PER_MIN = 0.9;

/**
 * Colour by what kind of thing it is, from the title.
 *
 * Google lets you colour events by hand and SAGE cannot read those colours
 * through the API, so the next best thing is to infer the category — a week
 * where lectures, training and revision are visually distinct is readable at a
 * glance in a way that one uniform colour never is.
 */
function toneOf(summary: string, feed?: string): string {
  const s = summary.toLowerCase();
  if (/workout|gym|zone|run|boxing|hiit|training|lift/.test(s)) return "body";
  if (/revise|revision|study|read|practice|prep\b/.test(s)) return "study";
  if (/lab|seminar|lecture|class|tutorial/.test(s)) return "class";
  if (/exam|test|interview|deadline|viva|submission/.test(s)) return "sharp";
  return feed ? "feed" : "plain";
}

/**
 * The week, as hours.
 *
 * A month grid answers "which days are busy"; a week answers "when am I
 * free", which is the question a timetable exists for. Events are positioned
 * by their real start and duration rather than listed, so a two-hour lab
 * looks like twice a one-hour lecture — the shape of the day is the
 * information.
 */
function WeekGrid({
  days, byDay, selected, onSelectDay,
}: {
  days: string[];
  byDay: Map<string, Ev[]>;
  selected: string;
  onSelectDay: (key: string) => void;
}) {
  const height = (DAY_END - DAY_START) * PX_PER_MIN;
  const hours: number[] = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) hours.push(m);

  const nowMinutes = minutesInto(new Date().toISOString());
  const today = todayKey();

  return (
    <div className="wk">
      <div className="wk-head">
        <span className="wk-gutterhead">IST</span>
        {days.map((key) => {
          const d = new Date(`${key}T12:00:00Z`);
          return (
            <button
              key={key}
              onClick={() => onSelectDay(key)}
              className={cn("wk-day", key === today && "today", key === selected && "sel")}
            >
              <span className="wk-dow">{d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
              <span className="wk-num">{d.getUTCDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="wk-body" style={{ height }}>
        <div className="wk-gutter">
          {hours.map((m) => (
            <span key={m} className="wk-hour" style={{ top: (m - DAY_START) * PX_PER_MIN }}>
              {String(Math.floor(m / 60)).padStart(2, "0")}
            </span>
          ))}
        </div>

        {days.map((key) => {
          const events = (byDay.get(key) ?? []).filter((e) => !e.allDay);
          return (
            <div key={key} className={cn("wk-col", key === selected && "sel")} onClick={() => onSelectDay(key)}>
              {hours.map((m) => (
                <span key={m} className="wk-line" style={{ top: (m - DAY_START) * PX_PER_MIN }} />
              ))}

              {/* Where we are, right now. */}
              {key === today && nowMinutes >= DAY_START && nowMinutes <= DAY_END && (
                <span className="wk-now" style={{ top: (nowMinutes - DAY_START) * PX_PER_MIN }} />
              )}

              {events.map((e, i) => {
                const startM = minutesInto(e.start);
                const endM = e.end ? minutesInto(e.end) : startM + 60;
                // An event ending past the visible window is clipped rather
                // than dropped; one starting before it is pinned to the top.
                const top = Math.max(0, (startM - DAY_START) * PX_PER_MIN);
                const raw = (Math.max(endM, startM + 20) - Math.max(startM, DAY_START)) * PX_PER_MIN;
                const h = Math.min(raw, height - top);
                if (h <= 0) return null;

                return (
                  <div
                    key={e.id ?? i}
                    className={cn("wk-ev", toneOf(e.summary, e.feed))}
                    style={{ top, height: h }}
                    title={`${e.summary} · ${timeOf(e.start)}`}
                  >
                    <b>{e.summary}</b>
                    {h > 34 && <i>{timeOf(e.start)}{e.end ? `–${timeOf(e.end)}` : ""}</i>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [events, setEvents] = useState<Ev[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [lead, setLead] = useState(15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(todayKey());
  /**
   * Week is the default because it is the view a timetable lives in — a month
   * grid tells you which days are busy, a week tells you when you are free.
   */
  const [view, setView] = useState<"week" | "month">("week");

  const [draft, setDraft] = useState({ summary: "", time: "09:00", minutes: 60, location: "", allDay: false });
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const cells = useMemo(() => monthGrid(year, month), [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    // A little either side of the grid, so events that spill in from the
    // neighbouring month still appear on the squares that show them.
    const from = new Date(Date.UTC(year, month, 1, 12));
    from.setUTCDate(from.getUTCDate() - 10);
    const to = new Date(Date.UTC(year, month + 1, 1, 12));
    to.setUTCDate(to.getUTCDate() + 10);

    const j = await fetch(`/api/calendar?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((r) => r.json()).catch(() => null);
    setLoading(false);

    if (j?.ok) {
      setEvents(j.data.events ?? []);
      setFeeds(j.data.feeds ?? []);
      setLead(j.data.lead ?? 15);
      setError(null);
    } else {
      setError(j?.error ?? "Couldn't read your calendar.");
    }
  }, [year, month]);
  useEffect(() => { void load(); }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Ev[]>();
    for (const e of events) {
      // An all-day event's date is already a plain date; converting it through
      // a timezone would shift it a day.
      const key = e.allDay ? e.start.slice(0, 10) : dayOf(e.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
    }
    return map;
  }, [events]);

  const step = (by: number) => {
    if (view === "week") {
      // A week view that pages by month would skip five days at a time.
      const d = new Date(`${selected}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + by * 7);
      const key = d.toISOString().slice(0, 10);
      setSelected(key);
      setYear(d.getUTCFullYear());
      setMonth(d.getUTCMonth());
      return;
    }
    const d = new Date(Date.UTC(year, month + by, 1, 12));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
  };

  const create = async () => {
    if (!draft.summary.trim() || saving) return;
    setSaving(true);

    // The selected square is a date in his timezone; the time is wall-clock.
    // Sending the pair as a naive local string and letting the API attach the
    // timezone keeps the two from disagreeing.
    const startLocal = `${selected}T${draft.allDay ? "00:00" : draft.time}:00`;
    const start = new Date(`${startLocal}+05:30`).toISOString();
    const end = new Date(new Date(start).getTime() + Math.max(5, draft.minutes) * 60_000).toISOString();

    const j = await fetch("/api/calendar", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary: draft.summary.trim(),
        start, end,
        allDay: draft.allDay,
        ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
      }),
    }).then((r) => r.json()).catch(() => null);
    setSaving(false);

    if (j?.ok) {
      setDraft({ summary: "", time: draft.time, minutes: draft.minutes, location: "", allDay: false });
      setFormOpen(false);
      void load();
    } else {
      setError(j?.error ?? "Couldn't add that event.");
    }
  };

  const remove = async (id?: string) => {
    if (!id) return;
    setEvents((p) => p.filter((e) => e.id !== id));
    await fetch("/api/calendar", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    void load();
  };

  const selectedEvents = byDay.get(selected) ?? [];
  const monthLabel = new Date(Date.UTC(year, month, 1, 12))
    .toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="cal-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}>
          <span className="sn"><CalendarDays className="size-3.5" /></span>
          <h2>Calendar</h2><span className="line" />
          {loading && <span className="tag">LOADING</span>}
        </div>
        <div className="cal-nav">
          <button onClick={() => step(-1)} title="Previous month"><ChevronLeft className="size-4" /></button>
          <span className="cal-month">{monthLabel}</span>
          <button onClick={() => step(1)} title="Next month"><ChevronRight className="size-4" /></button>
          <button
            onClick={() => { const t = new Date(); setYear(t.getFullYear()); setMonth(t.getMonth()); setSelected(todayKey()); }}
            className="cal-today"
          >
            TODAY
          </button>
          <div className="cal-views">
            <button onClick={() => setView("week")} className={cn(view === "week" && "on")}>WEEK</button>
            <button onClick={() => setView("month")} className={cn(view === "month" && "on")}>MONTH</button>
          </div>
        </div>
      </div>

      {error && <p className="cal-err"><AlertTriangle className="inline size-3.5" /> {error}</p>}

      {feeds.length > 0 && (
        <div className="cal-feeds">
          <span className="cal-feedlbl">READING</span>
          <span className="cal-feed own">Google</span>
          {feeds.map((f) => (
            <span key={f.label} className={cn("cal-feed", !f.enabled && "off", f.error && "bad")}>
              {f.label}{f.error ? " · unreadable" : f.enabled ? "" : " · off"}
            </span>
          ))}
        </div>
      )}

      {view === "week" ? (
        <WeekGrid
          days={weekOf(selected)}
          byDay={byDay}
          selected={selected}
          onSelectDay={setSelected}
        />
      ) : (
      <div className="cal-grid">
        {WEEKDAYS.map((d) => <span key={d} className="cal-dow">{d}</span>)}

        {cells.map(({ key, inMonth }) => {
          const dayEvents = byDay.get(key) ?? [];
          const isToday = key === todayKey();
          return (
            <button
              key={key}
              onClick={() => { setSelected(key); setFormOpen(false); }}
              className={cn(
                "cal-cell",
                !inMonth && "dim",
                isToday && "today",
                selected === key && "selected",
              )}
            >
              <span className="cal-date">{Number(key.slice(8, 10))}</span>
              <span className="cal-events">
                {dayEvents.slice(0, 3).map((e, i) => (
                  <span key={i} className={cn("cal-chip", e.feed && "feed", e.allDay && "allday")}>
                    {!e.allDay && <i>{timeOf(e.start)}</i>} {e.summary}
                  </span>
                ))}
                {dayEvents.length > 3 && <span className="cal-more">+{dayEvents.length - 3} more</span>}
              </span>
            </button>
          );
        })}
      </div>
      )}

      {/* ── the selected day ───────────────────────────────────────────── */}
      <div className="cal-day">
        <div className="cal-dayhead">
          <h3>
            {new Date(`${selected}T12:00:00Z`).toLocaleDateString("en-GB", {
              weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
            })}
          </h3>
          <span className="cal-daycount">
            {selectedEvents.length === 0 ? "nothing scheduled" : `${selectedEvents.length} event${selectedEvents.length === 1 ? "" : "s"}`}
          </span>
          <button onClick={() => setFormOpen((s) => !s)} className="cc-btn cc-scan">
            {formOpen ? <X className="size-3.5" /> : <Plus className="size-3.5" />} {formOpen ? "Cancel" : "Add"}
          </button>
        </div>

        {formOpen && (
          <div className="cal-form">
            <input
              value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="What is it?" className="cal-input cal-grow"
            />
            {!draft.allDay && (
              <>
                <input
                  type="time" value={draft.time}
                  onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                  className="cal-input"
                />
                <input
                  type="number" min={5} step={5} value={draft.minutes}
                  onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })}
                  className="cal-input cal-mins" title="Minutes"
                />
              </>
            )}
            <input
              value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              placeholder="Where (optional)" className="cal-input"
            />
            <label className="cal-check">
              <input
                type="checkbox" checked={draft.allDay}
                onChange={(e) => setDraft({ ...draft, allDay: e.target.checked })}
              />
              All day
            </label>
            <button onClick={() => void create()} disabled={saving || !draft.summary.trim()} className="cc-btn cc-scan">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add
            </button>
          </div>
        )}

        {selectedEvents.length === 0 && !formOpen && (
          <p className="cal-empty">Nothing on this day.</p>
        )}

        <div className="cal-list">
          {selectedEvents.map((e, i) => (
            <div key={e.id ?? i} className="cal-row">
              <span className="cal-when">
                {e.allDay ? "all day" : `${timeOf(e.start)}${e.end ? `–${timeOf(e.end)}` : ""}`}
              </span>
              <span className="cal-title">
                {e.summary}
                {e.feed && <em className="cal-src">{e.feed}</em>}
              </span>
              {e.location && <span className="cal-where"><MapPin className="size-3" /> {e.location}</span>}
              {/* Feed events belong to someone else's calendar — no delete. */}
              {e.feed ? (
                <span className="cal-readonly" title="From a subscribed calendar — edit it at the source">read-only</span>
              ) : (
                <button onClick={() => void remove(e.id)} className="cc-del" title="Remove"><Trash2 className="size-3.5" /></button>
              )}
            </div>
          ))}
        </div>

        <p className="cal-hint">
          <Clock className="inline size-3" /> Every timed event here gets a nudge {lead} minutes
          before it starts — subscribed calendars included.
        </p>
      </div>
    </div>
  );
}
