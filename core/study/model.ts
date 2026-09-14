/**
 * Subjects, units, and the arithmetic over them. No database, no server.
 *
 * Split out of subjects.ts because the study page is a client component and
 * imports completion(), pace() and friends — and an import pulls the whole
 * module, not the symbol. Keeping the pure half "above the db import" is
 * enough for a test that only calls it; it is not enough for a bundler, which
 * followed the file into Supabase and tried to resolve node:async_hooks in
 * the browser.
 *
 * So the rule is now structural rather than a convention about line order:
 * anything the browser needs lives here, anything that touches the database
 * lives in subjects.ts, and the arrow only ever points this way.
 *
 * The skill ledger already tracks fine-grained competence — "trees", "dynamic
 * programming" — on a 0–5 scale. That is the right shape for a thing you get
 * better at forever, and the wrong shape for a semester: a subject has a
 * syllabus with a bottom, and the question you actually ask about it is "how
 * much is left", which a level cannot answer.
 *
 * So this is the other axis, and it is deliberately finite:
 *
 *   Subject · what you are studying, with an exam at the end of it
 *   Unit    · a chapter of that subject, done or not done
 *   Slot    · when in the week you intend to sit with it
 *   Session · minutes actually spent, against a subject and usually a unit
 *
 * Percentage complete comes from units, weighted, because that is a thing the
 * syllabus knows. Time comes from sessions, because that is a thing the clock
 * knows. They are kept apart on purpose: hours spent is not progress, and a
 * page that adds them together teaches you to sit with a book open.
 *
 * The pure half is above the database import so the arithmetic can be tested
 * without one.
 */

/*
 * tzDay, not core/history's dayKey — they compute the identical string, but
 * core/history also imports the database, and an import pulls the whole
 * module. Reaching for the one in lib/config keeps this file loadable in a
 * browser, which is the entire point of the split.
 */
import { tzDay } from "@/lib/config";

export interface Unit {
  id: string;
  name: string;
  /** Relative size. A unit worth two of another is 2. */
  weight: number;
  doneAt?: string | null;
  /** Optional: what the unit actually covers, for SAGE and for revision. */
  notes?: string;
}

/** A standing weekly intention: Tuesday 18:00, ninety minutes. */
export interface Slot {
  id: string;
  /** 0 = Sunday, matching Date#getDay. */
  weekday: number;
  /** Minutes from midnight, so "18:30" is 1110. */
  startMin: number;
  minutes: number;
}

export interface Subject {
  id: string;
  name: string;
  /** Course code, if it has one — "CS3501". Shown small, used for matching. */
  code?: string;
  /** One of the palette tones, so every chart for a subject agrees on colour. */
  tone: string;
  units: Unit[];
  slots: Slot[];
  /** Hours a week this is meant to get. The plan, against which reality reads. */
  targetHoursPerWeek: number;
  /** The paper this is building towards, by exam id. */
  examId?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  subjectId: string;
  unitId?: string | null;
  minutes: number;
  at: string;
  note?: string;
}

/* ── the arithmetic ──────────────────────────────────────────────────────── */

/** Units done over units total, by weight. 0 when there is no syllabus yet. */
export function completion(subject: Pick<Subject, "units">): number {
  const total = subject.units.reduce((n, u) => n + Math.max(0, u.weight || 1), 0);
  if (!total) return 0;
  const done = subject.units
    .filter((u) => u.doneAt)
    .reduce((n, u) => n + Math.max(0, u.weight || 1), 0);
  return done / total;
}

/** Minutes a week the slots add up to — the plan as written in the timetable. */
export function scheduledMinutes(subject: Pick<Subject, "slots">): number {
  return subject.slots.reduce((n, s) => n + Math.max(0, s.minutes || 0), 0);
}

/**
 * Minutes per day for a subject, dense and zero-filled.
 *
 * Zero-filled for the same reason every other series in SAGE is: a fortnight
 * of nothing has to be a fortnight wide, or the chart tells a story the data
 * does not support.
 */
export function minutesByDay(sessions: Session[], days: string[]): number[] {
  const acc = new Map<string, number>();
  for (const s of sessions) {
    const k = tzDay(s.at);
    acc.set(k, (acc.get(k) ?? 0) + Math.max(0, s.minutes || 0));
  }
  return days.map((d) => acc.get(d) ?? 0);
}

/** Minutes per unit, for the bars that show where the time actually went. */
export function minutesByUnit(sessions: Session[], units: Unit[]): { unit: Unit; minutes: number }[] {
  const acc = new Map<string, number>();
  for (const s of sessions) {
    if (!s.unitId) continue;
    acc.set(s.unitId, (acc.get(s.unitId) ?? 0) + Math.max(0, s.minutes || 0));
  }
  return units.map((u) => ({ unit: u, minutes: acc.get(u.id) ?? 0 }));
}

/** Minutes per weekday (0=Sun), for the "when do I actually study" heat. */
export function minutesByWeekday(sessions: Session[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sessions) out[new Date(s.at).getDay()] += Math.max(0, s.minutes || 0);
  return out;
}

/**
 * Are you ahead of the syllabus or behind it?
 *
 * Compares the share of the syllabus finished against the share of the run-up
 * that has elapsed. Both are fractions of the same thing — the stretch between
 * starting and the paper — so the difference is meaningful: +0.1 is a tenth of
 * the syllabus ahead of the clock.
 *
 * Null rather than zero when there is no exam date or no syllabus. A pace with
 * nothing to pace against is not zero drift, it is an unanswerable question,
 * and answering it anyway is how a dashboard starts lying.
 */
export function pace(
  subject: Pick<Subject, "units" | "createdAt">,
  examAt: string | null | undefined,
  now = new Date(),
): number | null {
  if (!examAt || subject.units.length === 0) return null;
  const start = new Date(subject.createdAt).getTime();
  const end = new Date(examAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const elapsed = (now.getTime() - start) / (end - start);
  if (elapsed <= 0) return null;                      // the run-up has not begun
  return completion(subject) - Math.min(1, elapsed);
}

/**
 * How many minutes a week this has actually been getting, over `weeks`.
 *
 * Averaged over whole weeks rather than "minutes since the first session",
 * which flatters a subject you touched once yesterday.
 */
export function weeklyActual(sessions: Session[], weeks = 4): number {
  if (weeks <= 0) return 0;
  const since = Date.now() - weeks * 7 * 86_400_000;
  const total = sessions
    .filter((s) => new Date(s.at).getTime() >= since)
    .reduce((n, s) => n + Math.max(0, s.minutes || 0), 0);
  return Math.round(total / weeks);
}

/** The next slot due, as a weekday/minute pair, searching forward from now. */
export function nextSlot(slots: Slot[], now = new Date()): { slot: Slot; inMinutes: number } | null {
  if (!slots.length) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();

  let best: { slot: Slot; inMinutes: number } | null = null;
  for (const s of slots) {
    // Days until that weekday comes round, then the gap within the day.
    let days = (s.weekday - today + 7) % 7;
    if (days === 0 && s.startMin <= nowMin) days = 7;
    const inMinutes = days * 1440 + (s.startMin - nowMin);
    if (!best || inMinutes < best.inMinutes) best = { slot: s, inMinutes };
  }
  return best;
}

/**
 * Weighted units finished, cumulatively, across a run of days.
 *
 * Same numerator and denominator as completion(), so the chart and the
 * percentage cannot drift apart — they are one calculation read two ways.
 * A unit finished before the window starts counts from the first day, or the
 * line would appear to start from zero every time you widen the range.
 */
export function burnUp(units: Unit[], days: string[]): number[] {
  const total = units.reduce((n, u) => n + Math.max(0, u.weight || 1), 0);
  if (!total) return days.map(() => 0);

  return days.map((day) => {
    const done = units
      .filter((u) => u.doneAt && tzDay(u.doneAt) <= day)
      .reduce((n, u) => n + Math.max(0, u.weight || 1), 0);
    return Math.round((done / total) * 100);
  });
}

/** "18:30" from 1110. */
export function clockOf(startMin: number): string {
  const h = Math.floor(startMin / 60) % 24;
  const m = startMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;


/**
 * Today's study slots, as concrete times.
 *
 * The timetable is a standing weekly intention; a day needs it as actual
 * clock times so it can sit beside calendar events and be turned into tasks.
 * Returned in the order they occur, and only for the day asked about.
 */
export function slotsOn(
  subjects: { id: string; name: string; slots: Slot[] }[],
  when = new Date(),
): { subjectId: string; subject: string; slot: Slot; startsAt: Date; endsAt: Date }[] {
  const weekday = when.getDay();
  const out: { subjectId: string; subject: string; slot: Slot; startsAt: Date; endsAt: Date }[] = [];

  for (const s of subjects) {
    for (const slot of s.slots) {
      if (slot.weekday !== weekday) continue;
      const startsAt = new Date(when);
      startsAt.setHours(Math.floor(slot.startMin / 60), slot.startMin % 60, 0, 0);
      const endsAt = new Date(startsAt.getTime() + slot.minutes * 60_000);
      out.push({ subjectId: s.id, subject: s.name, slot, startsAt, endsAt });
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Which slots a day still has ahead of it, and which have passed.
 *
 * "Passed" means the slot's end time is behind us, not its start — you are not
 * late for something you are in the middle of.
 */
export function splitByNow<T extends { startsAt: Date; endsAt: Date }>(
  slots: T[],
  now = new Date(),
): { past: T[]; current: T | null; upcoming: T[] } {
  const past = slots.filter((s) => s.endsAt.getTime() <= now.getTime());
  const current = slots.find((s) => s.startsAt.getTime() <= now.getTime() && s.endsAt.getTime() > now.getTime()) ?? null;
  const upcoming = slots.filter((s) => s.startsAt.getTime() > now.getTime());
  return { past, current, upcoming };
}
