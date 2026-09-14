/**
 * Subjects and sessions, stored.
 *
 * The arithmetic lives in ./model, which has no database import so the study
 * page can use it in the browser. This half is server-only: it reads and
 * writes Event rows and must never be imported from a client component.
 */

import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { trashRow } from "@/core/ops/trash";
import type { Subject, Session, Unit, Slot } from "./model";
import { clockOf, moveUnit, parseUnitNames, slotsOn, splitByNow } from "./model";

export * from "./model";

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
    boardId: input.boardId ?? null,
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

/**
 * A whole syllabus in one paste.
 *
 * One write rather than one per unit: twenty chapters used to be twenty round
 * trips, each reading and rewriting the subject, and a failure halfway left
 * half a syllabus. Names already present are skipped rather than duplicated,
 * matched case-insensitively — "Memory management" pasted under "Memory
 * Management" is the same chapter.
 */
export async function addUnits(subjectId: string, input: string): Promise<{ subject: Subject | null; added: number; skipped: number }> {
  const subjects = await listSubjects(true);
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return { subject: null, added: 0, skipped: 0 };

  const have = new Set(subject.units.map((u) => u.name.toLowerCase()));
  const names = parseUnitNames(input).filter((n) => !have.has(n.toLowerCase()));
  const skipped = parseUnitNames(input).length - names.length;
  if (!names.length) return { subject, added: 0, skipped };

  const units = [
    ...subject.units,
    ...names.map((name) => ({ id: crypto.randomUUID(), name, weight: 1, doneAt: null })),
  ];
  return { subject: await upsertSubject({ id: subjectId, units }), added: names.length, skipped };
}

/** Move a unit up or down the syllabus. */
export async function reorderUnit(subjectId: string, unitId: string, delta: number): Promise<Subject | null> {
  const subjects = await listSubjects(true);
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return null;
  return upsertSubject({ id: subjectId, units: moveUnit(subject.units, unitId, delta) });
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

/**
 * Today's remaining slots, as tasks.
 *
 * The timetable is an intention and the task list is where intentions go to
 * be argued with, so a slot that never reaches it mostly does not happen.
 *
 * Idempotent by title within the day: pressing the button twice, or a cron
 * running alongside a click, must not produce two identical directives. The
 * title carries the subject and the clock time, which is exactly the
 * granularity at which a duplicate would be wrong — two different subjects at
 * the same hour are two real tasks, and the same subject twice is not.
 *
 * Only slots still ahead. Filing a task for a session that finished at nine
 * this morning is how a task list stops being read.
 */
export async function slotsToTasks(now = new Date()): Promise<{ created: number; skipped: number; titles: string[] }> {
  const subjects = await listSubjects();
  const today = slotsOn(subjects, now);
  const { upcoming, current } = splitByNow(today, now);
  const due = current ? [current, ...upcoming] : upcoming;
  if (!due.length) return { created: 0, skipped: 0, titles: [] };

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const { data: existing } = await db
    .from("Task")
    .select("title")
    .eq("userId", DEFAULT_USER_ID)
    .eq("source", "study")
    .gte("createdAt", startOfDay.toISOString());
  const seen = new Set((existing ?? []).map((t) => String(t.title)));

  let created = 0, skipped = 0;
  const titles: string[] = [];

  for (const s of due) {
    const clock = clockOf(s.slot.startMin);
    const title = `Study ${s.subject} — ${clock}`;
    if (seen.has(title)) { skipped += 1; continue; }

    const { error } = await db.from("Task").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      title,
      priority: 1,
      dueAt: s.startsAt.toISOString(),
      source: "study",
    });
    if (error) continue;
    created += 1;
    seen.add(title);
    titles.push(title);
  }

  return { created, skipped, titles };
}
