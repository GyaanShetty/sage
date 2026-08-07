import { NextResponse } from "next/server";
import {
  listExams, addExam, markExamDone, deleteExam, listQuestions, markAttempted,
  generateQuestions, nextExam, countdownFor, inExamMode, gradeAnswer, topicWeakness,
} from "@/core/exam";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const examId = new URL(req.url).searchParams.get("examId") ?? undefined;
  const exams = await listExams();
  const next = nextExam(exams);
  const questions = await listQuestions(examId ?? next?.id);
  return NextResponse.json({
    ok: true,
    data: {
      exams,
      questions,
      examMode: inExamMode(exams),
      countdown: next ? countdownFor(next) : null,
      weakest: topicWeakness(questions),
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    subject?: string; at?: string; syllabus?: string;
    id?: string; done?: boolean; attempted?: boolean; generate?: boolean; answer?: string;
  };

  // An answer names the question it is answering.
  if (body.id && typeof body.answer === "string") {
    const result = await gradeAnswer(body.id, body.answer);
    if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, data: result });
  }

  if (body.id && body.attempted) {
    await markAttempted(body.id);
    return NextResponse.json({ ok: true });
  }

  if (body.id && typeof body.done === "boolean") {
    await markExamDone(body.id, body.done);
    return NextResponse.json({ ok: true });
  }

  // Ask for a set now rather than waiting for the night shift.
  if (body.id && body.generate) {
    const exam = (await listExams()).find((e) => e.id === body.id);
    if (!exam) return NextResponse.json({ ok: false, error: "No such exam." }, { status: 404 });
    const made = await generateQuestions(exam);
    return made > 0
      ? NextResponse.json({ ok: true, data: { made } })
      : NextResponse.json(
          { ok: false, error: "Couldn't set any — check the syllabus has something in it, or the keys are not rate-limited." },
          { status: 502 },
        );
  }

  if (!body.subject?.trim() || !body.at) {
    return NextResponse.json({ ok: false, error: "A paper needs a subject and a date." }, { status: 400 });
  }

  const id = await addExam({ subject: body.subject, at: body.at, syllabus: body.syllabus ?? "" });
  return NextResponse.json({ ok: !!id, data: { id } }, { status: id ? 200 : 400 });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteExam(id);
  return NextResponse.json({ ok: true });
}
