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
