"use client";

/**
 * What am I training today.
 *
 * SAGE has no training PLAN, and inventing one would mean a panel that
 * confidently tells him to do legs on a day he had already decided to
 * box. What it does have is three real sources, and between them they
 * answer the question honestly:
 *
 *   · the CALENDAR, which is where "18:00 Boxing (HIIT)" actually lives.
 *     If a session is booked, that IS today's answer and nothing else
 *     needs to be guessed;
 *   · the LOG, for whether today already happened and how the week is
 *     going against the target;
 *   · the ROTATION — the longest-untrained movement among the things he
 *     actually does. Not advice, an observation: "chest, 9 days". On a
 *     day with nothing booked that is the most useful true sentence
 *     available, and it is clearly marked as the weakest of the three.
 *
 * The week strip is seven cells rather than "3/4", because the shape of
 * the week tells you whether you did three sessions on three days or
 * three on Sunday.
 */

import { useCallback, useMemo, useState } from "react";
import { Pane } from "@/components/pane";
import { asArray } from "@/lib/as-array";
import { useLive } from "@/lib/live";
import type { EventRow } from "./command-view";

interface Workout {
  id: string; type: string; minutes: number;
  intensity: "easy" | "moderate" | "hard";
  kcal: number | null; day: string;
}
interface Health {
  workouts: Workout[];
  workoutsThisWeek: number;
  goals: { workoutsPerWeek: number };
}

/* Words that make a calendar entry a training session. Deliberately short:
   a loose list turns "coffee with Ryan" into a run because it contains
   "run". Each of these is a thing he actually books. */
const TRAINING = /\b(gym|workout|training|boxing|hiit|run|running|lift|lifting|swim|yoga|cycle|cycling|cardio|climb|climbing)\b/i;

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;

const hhmm = (d: Date) =>
  `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;

export function TrainingTile({ n, events }: { n?: number; events: EventRow[] | null }) {
  const [health, setHealth] = useState<Health | null>(null);

  const load = useCallback(() =>
    fetch("/api/health?days=60")
      .then((r) => r.json())
      .then((j) => setHealth(j.data ?? null))
      .catch(() => { /* keep the last good reading */ }),
  []);

  useLive(load, { everyMs: 300_000, scopes: ["health"] });

  const now = new Date();
  const todayK = dayKey(now);

  /* Today's booked session, from the calendar. */
  const booked = (events ?? [])
    .map((e) => ({ e, d: new Date(e.start) }))
    .filter((x) => !Number.isNaN(x.d.getTime()))
    .filter((x) => dayKey(x.d) === todayK && TRAINING.test(x.e.summary ?? ""))
    .sort((a, b) => a.d.getTime() - b.d.getTime())[0];

  const workouts = asArray<Workout>(health?.workouts);
  const doneToday = workouts.find((w) => w.day === todayK) ?? null;
  const target = health?.goals?.workoutsPerWeek ?? 4;

  /* The last seven days, oldest first, each either trained or not. */
  const week = useMemo(() => {
    const out: { key: string; label: string; done: boolean; today: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const k = dayKey(d);
      out.push({
        key: k,
        label: ["S", "M", "T", "W", "T", "F", "S"][d.getDay()],
        done: workouts.some((w) => w.day === k),
        today: k === todayK,
      });
    }
    return out;
    // `now` is a fresh Date each render; the key is the day, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workouts, todayK]);

  const doneThisWeek = week.filter((d) => d.done).length;

  /* The longest-untrained type among things he has actually logged. */
  const rotation = useMemo(() => {
    const last = new Map<string, string>();
    for (const w of workouts) {
      const t = (w.type || "").trim().toLowerCase();
      if (!t) continue;
      const prev = last.get(t);
      if (!prev || w.day > prev) last.set(t, w.day);
    }
    const rows = [...last.entries()].map(([type, day]) => {
      const days = Math.round((Date.parse(todayK) - Date.parse(day)) / 86_400_000);
      return { type, days };
    });
    return rows.sort((a, b) => b.days - a.days)[0] ?? null;
  }, [workouts, todayK]);

  /*
   * Eight weeks of volume.
   *
   * The seven-day strip says whether this week is on track; it cannot say
   * whether the last two months have been. Minutes rather than session
   * count, because four twenty-minute sessions and four ninety-minute
   * ones are not the same week and counting sessions says they are.
   */
  const weeks = useMemo(() => {
    const out: { start: Date; minutes: number; sessions: number }[] = [];
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    for (let i = 7; i >= 0; i--) {
      const s = new Date(monday); s.setDate(s.getDate() - i * 7);
      const e = new Date(s); e.setDate(e.getDate() + 7);
      const inWeek = workouts.filter((w) => {
        const t = Date.parse(w.day);
        return !Number.isNaN(t) && t >= s.getTime() && t < e.getTime();
      });
      out.push({
        start: s,
        minutes: inWeek.reduce((a, w) => a + (w.minutes || 0), 0),
        sessions: inWeek.length,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workouts, todayK]);

  const volPeak = Math.max(1, ...weeks.map((w) => w.minutes));

  const status = doneToday ? "DONE" : booked ? hhmm(booked.d) : `${doneThisWeek}/${target}`;

  return (
    <Pane n={n} title="Training" status={status} live={!!booked && !doneToday}>
      <div className="tr">

        {/* ── today ──────────────────────────────────────────────── */}
        <div className="tr-today">
          {doneToday ? (
            <>
              <span className="tr-state done">Logged</span>
              <span className="tr-what">{doneToday.type}</span>
              <span className="tr-when num">{doneToday.minutes}m · {doneToday.intensity}</span>
            </>
          ) : booked ? (
            <>
              <span className="tr-state next">{hhmm(booked.d)}</span>
              <span className="tr-what">{booked.e.summary}</span>
              <span className="tr-when">booked</span>
            </>
          ) : (
            <>
              <span className="tr-state">Rest</span>
              <span className="tr-what quiet">Nothing booked or logged</span>
            </>
          )}
        </div>

        {/* ── the week ───────────────────────────────────────────── */}
        {/* The count lives in the pane header. This strip is the SHAPE of
            the week — which days, not how many — and a second tally beside
            it was both a duplicate and the one cramped thing on the rail. */}
        <div className="tr-week" role="img" aria-label={`${doneThisWeek} of ${target} sessions this week`}>
          {week.map((d) => (
            <span
              className={`tr-day${d.done ? " on" : ""}${d.today ? " now" : ""}`}
              key={d.key}
              title={`${d.key}${d.done ? " · trained" : ""}`}
            >
              <i />
              <b>{d.label}</b>
            </span>
          ))}
        </div>

        {/* ── eight weeks of volume ──────────────────────────────── */}
        <div className="tr-vol" role="img"
             aria-label={`Training minutes by week, peak ${volPeak} minutes`}>
          {weeks.map((w, i) => (
            <span
              className={`tr-vb${i === weeks.length - 1 ? " now" : ""}`}
              key={i}
              title={`week of ${w.start.toDateString()} · ${w.sessions} session${w.sessions === 1 ? "" : "s"}, ${w.minutes} min`}
            >
              <i style={{ height: `${w.minutes ? Math.max(6, (w.minutes / volPeak) * 100) : 1}%` }} />
            </span>
          ))}
          <span className="tr-vol-k num">{volPeak}<em>m peak</em></span>
        </div>

        {/* ── the rotation ───────────────────────────────────────── */}
        {rotation && rotation.days > 0 && (
          <p className="tr-rot">
            <span className="tr-rot-k">Longest untrained</span>
            <span className="tr-rot-t">{rotation.type}</span>
            <span className="tr-rot-n num">{rotation.days}d</span>
          </p>
        )}

        {!health && <p className="tr-quiet">Reading the log…</p>}
      </div>
    </Pane>
  );
}
