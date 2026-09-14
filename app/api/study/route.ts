/**
 * Everything the study page needs, in one call.
 *
 * Subjects, their sessions and the exams they point at arrive together
 * because the page draws them together — a chart of minutes per unit is
 * useless without the units, and two round trips to paint one wall is how a
 * free tier gets spent on nothing.
 */

import { NextResponse } from "next/server";
import {
  listSubjects, upsertSubject, deleteSubject,
  putUnit, removeUnit, putSlot, removeSlot,
  logSession, listSessions, deleteSession,
  type Subject,
} from "@/core/study/subjects";
import { listExams } from "@/core/exam";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const days = Math.max(7, Math.min(365, Number(q.get("days") ?? 120)));

  const [subjects, sessions, exams] = await Promise.all([
    listSubjects(q.get("archived") === "1"),
    listSessions(q.get("subjectId") ?? undefined, days),
    listExams().catch(() => []),
  ]);

  return NextResponse.json({ ok: true, data: { subjects, sessions, exams } });
}

type Body = Partial<Subject> & {
  action?: string;
  subjectId?: string;
  unit?: { id?: string; name?: string; weight?: number; doneAt?: string | null; notes?: string };
  unitId?: string;
  slot?: { id?: string; weekday?: number; startMin?: number; minutes?: number };
  slotId?: string;
  session?: { unitId?: string | null; minutes?: number; note?: string; at?: string };
  sessionId?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;

  switch (body.action) {
    case "unit": {
      if (!body.subjectId || !body.unit) return bad("subjectId and unit required");
      const s = await putUnit(body.subjectId, body.unit);
      return s ? ok(s) : bad("Couldn't save that unit");
    }
    case "unit.remove": {
      if (!body.subjectId || !body.unitId) return bad("subjectId and unitId required");
      const s = await removeUnit(body.subjectId, body.unitId);
      return s ? ok(s) : bad("Couldn't remove that unit");
    }
    case "slot": {
      if (!body.subjectId || !body.slot) return bad("subjectId and slot required");
      const s = await putSlot(body.subjectId, body.slot);
      return s ? ok(s) : bad("Couldn't save that slot");
    }
    case "slot.remove": {
      if (!body.subjectId || !body.slotId) return bad("subjectId and slotId required");
      const s = await removeSlot(body.subjectId, body.slotId);
      return s ? ok(s) : bad("Couldn't remove that slot");
    }
    case "session": {
      if (!body.subjectId || !body.session?.minutes) return bad("subjectId and minutes required");
      const s = await logSession({
        subjectId: body.subjectId,
        unitId: body.session.unitId ?? null,
        minutes: body.session.minutes,
        note: body.session.note,
        at: body.session.at,
      });
      return s ? ok(s) : bad("Couldn't log that session");
    }
    default: {
      const s = await upsertSubject(body);
      return s ? ok(s) : bad("Couldn't save that subject");
    }
  }
}

export async function DELETE(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get("id");
  if (!id) return bad("id required");
  if (q.get("kind") === "session") await deleteSession(id);
  else await deleteSubject(id);
  return NextResponse.json({ ok: true });
}

const ok = (data: unknown) => NextResponse.json({ ok: true, data });
const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });
