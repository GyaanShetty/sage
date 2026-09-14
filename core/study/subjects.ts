/**
 * Subjects, units, and the time that goes into them.
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

import { dayKey } from "@/core/history";

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
    const k = dayKey(s.at);
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

/** "18:30" from 1110. */
export function clockOf(startMin: number): string {
  const h = Math.floor(startMin / 60) % 24;
  const m = startMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/* ── storage ─────────────────────────────────────────────────────────────
   Below the arithmetic, so everything above can be tested without a db. */

import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { trashRow } from "@/core/ops/trash";

const SUBJECT = "study.subject";
const SESSION = "study.session";

const TONES = ["signal", "amber", "cyan", "green", "plain"] as const;

export async function listSubjects(includeArchived = false): Promise<Subject[]> {
  const { data } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", SUBJECT)
    .order("createdAt", { ascending: true })
    .limit(60);

  return (data ?? [])
    .map((r) => ({ id: r.id as string, ...(r.payload as Omit<Subject, "id">) }))
    .filter((s) => (includeArchived ? true : !s.archivedAt));
}

export async function upsertSubject(
  input: Partial<Subject> & { id?: string },
): Promise<Subject | null> {
  const now = new Date().toISOString();

  if (input.id) {
    const { data } = await db.from("Event").select("payload").eq("id", input.id).maybeSingle();
    if (!data) return null;
    const prev = data.payload as Omit<Subject, "id">;
    const merged: Omit<Subject, "id"> = { ...prev, ...input, updatedAt: now };
    const { error } = await db.from("Event").update({ payload: merged }).eq("id", input.id);
    if (error) return null;
    return { id: input.id, ...merged };
  }

  if (!input.name?.trim()) return null;

  const subject: Omit<Subject, "id"> = {
    name: input.name.trim(),
    code: input.code?.trim() || undefined,
    tone: TONES.includes(input.tone as (typeof TONES)[number]) ? input.tone! : "signal",
    units: input.units ?? [],
    slots: input.slots ?? [],
    targetHoursPerWeek: Math.max(0, Math.min(60, input.targetHoursPerWeek ?? 4)),
    examId: input.examId ?? null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  // Event rows carry no default id — the column has none, and an insert
  // without one is rejected. Every writer in SAGE supplies its own.
  const id = crypto.randomUUID();
  const { error } = await db
    .from("Event")
    .insert({ id, userId: DEFAULT_USER_ID, type: SUBJECT, payload: subject });
  if (error) return null;
  return { id, ...subject };
}

export async function deleteSubject(id: string): Promise<void> {
  await trashRow("Event", id);
}

/** Add, rename, re-weight or tick a unit, without rewriting the whole subject. */
export async function putUnit(
  subjectId: string,
  unit: Partial<Unit> & { id?: string },
): Promise<Subject | null> {
  const subjects = await listSubjects(true);
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return null;

  const units = [...subject.units];
  if (unit.id) {
    const i = units.findIndex((u) => u.id === unit.id);
    if (i < 0) return null;
    units[i] = { ...units[i], ...unit, weight: Math.max(1, unit.weight ?? units[i].weight) };
  } else {
    if (!unit.name?.trim()) return null;
    units.push({
      id: crypto.randomUUID(),
      name: unit.name.trim(),
      weight: Math.max(1, unit.weight ?? 1),
      doneAt: null,
      ...(unit.notes ? { notes: unit.notes } : {}),
    });
  }
  return upsertSubject({ id: subjectId, units });
}

export async function removeUnit(subjectId: string, unitId: string): Promise<Subject | null> {
  const subjects = await listSubjects(true);
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return null;
  return upsertSubject({ id: subjectId, units: subject.units.filter((u) => u.id !== unitId) });
}

export async function putSlot(
  subjectId: string,
  slot: Partial<Slot> & { id?: string },
): Promise<Subject | null> {
  const subjects = await listSubjects(true);
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return null;

  const slots = [...subject.slots];
  if (slot.id) {
    const i = slots.findIndex((s) => s.id === slot.id);
    if (i < 0) return null;
    slots[i] = { ...slots[i], ...slot };
  } else {
    slots.push({
      id: crypto.randomUUID(),
      weekday: Math.max(0, Math.min(6, slot.weekday ?? 1)),
      startMin: Math.max(0, Math.min(1439, slot.startMin ?? 18 * 60)),
      minutes: Math.max(5, Math.min(600, slot.minutes ?? 60)),
    });
  }
  return upsertSubject({ id: subjectId, slots });
}

export async function removeSlot(subjectId: string, slotId: string): Promise<Subject | null> {
  const subjects = await listSubjects(true);
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return null;
  return upsertSubject({ id: subjectId, slots: subject.slots.filter((s) => s.id !== slotId) });
}

/** Minutes actually spent. Append-only: a session is a fact about a day. */
export async function logSession(input: {
  subjectId: string;
  unitId?: string | null;
  minutes: number;
  note?: string;
  at?: string;
}): Promise<Session | null> {
  const minutes = Math.max(1, Math.min(600, Math.round(input.minutes)));
  if (!input.subjectId || !Number.isFinite(minutes)) return null;

  const session: Omit<Session, "id"> = {
    subjectId: input.subjectId,
    unitId: input.unitId ?? null,
    minutes,
    at: input.at ?? new Date().toISOString(),
    ...(input.note ? { note: input.note.slice(0, 500) } : {}),
  };

  const id = crypto.randomUUID();
  const { error } = await db
    .from("Event")
    .insert({ id, userId: DEFAULT_USER_ID, type: SESSION, payload: session });
  if (error) return null;
  return { id, ...session };
}

export async function listSessions(subjectId?: string, days = 120): Promise<Session[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let q = db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", SESSION)
    .gte("createdAt", since)
    .order("createdAt", { ascending: false })
    .limit(2000);

  // JSON-path filter: the subject id lives inside the payload, not in a column.
  if (subjectId) q = q.eq("payload->>subjectId", subjectId);

  const { data } = await q;
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Session, "id">) }));
}

export async function deleteSession(id: string): Promise<void> {
  await trashRow("Event", id);
}
