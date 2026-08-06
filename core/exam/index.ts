import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { HUMAN_RULES } from "@/lib/config";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Exam mode.
 *
 * In the fortnight before an exam, almost nothing else the app tracks matters,
 * and a dashboard that gives equal weight to a crypto price and a paper he has
 * not opened is actively unhelpful. So: put the date in, and SAGE changes what
 * it does about it.
 *
 * Two concrete changes, not a theme:
 *
 *   1. A countdown that says what phase he is in and what that phase is for.
 *      The phases are not motivational — they encode the one thing the
 *      evidence is clear about, which is that testing yourself beats rereading,
 *      and that the switch should happen earlier than it feels like it should.
 *   2. The night shift stops researching whatever he last wondered about and
 *      starts generating practice questions off the syllabus instead. That is
 *      the work he would not do himself at 3am, and it is the work that helps.
 *
 * Nothing here hides pages or blocks anything. An app that decides he is not
 * allowed to look at his portfolio during exams would be wrong about him
 * roughly as often as it was right, and there is no undo for a wrong guess
 * about what someone needs to see.
 */

const TYPE = "exam.paper";
const Q_TYPE = "exam.question";

/** How close an exam has to be before it takes over the night shift. */
export const EXAM_MODE_DAYS = 21;

export interface Exam {
  id: string;
  subject: string;
  /** ISO datetime of the paper itself. */
  at: string;
  /** What is actually examinable. Questions are generated from this. */
  syllabus: string;
  at_created: string;
  doneAt?: string | null;
}

export type Phase = "far" | "build" | "test" | "eve" | "past";

export interface Countdown {
  exam: Exam;
  /** Whole days, floored — the day of the exam is zero. */
  days: number;
  hours: number;
  phase: Phase;
  headline: string;
  focus: string;
}

/**
 * Days between now and the paper, in whole days.
 *
 * Floored deliberately: an exam 30 hours away is "tomorrow", and rounding it
 * to two days is the kind of small lie that costs an evening.
 */
export function daysUntil(at: string, now = new Date()): number {
  return Math.floor((new Date(at).getTime() - now.getTime()) / 86_400_000);
}

export function phaseOf(days: number): Phase {
  if (days < 0) return "past";
  if (days === 0) return "eve";
  if (days <= 3) return "eve";
  if (days <= 10) return "test";
  if (days <= EXAM_MODE_DAYS) return "build";
  return "far";
}

const PHASE_COPY: Record<Phase, { headline: string; focus: string }> = {
  far: {
    headline: "Far enough out that nothing is urgent.",
    focus: "Cover the syllabus once, badly and quickly, so you know where the holes are before they matter.",
  },
  build: {
    headline: "Three weeks. This is the part people waste.",
    focus: "Learn the material you have not seen. Everything after this window is retrieval, not first contact — so anything genuinely new needs to land now.",
  },
  test: {
    headline: "Inside ten days. Stop reading.",
    focus: "Answer questions closed-book, then check. Rereading feels like progress and is not — recognising a page is not the same as producing an answer, and the exam only asks for the second.",
  },
  eve: {
    headline: "It is close.",
    focus: "Past papers under time, and sleep. A new topic tonight buys less than the hour of sleep it costs, and sleep is what consolidates everything you already did.",
  },
  past: {
    headline: "Done.",
    focus: "Mark it off so it stops taking over the night shift.",
  },
};

export function countdownFor(exam: Exam, now = new Date()): Countdown {
  const ms = new Date(exam.at).getTime() - now.getTime();
  const days = daysUntil(exam.at, now);
  const phase = phaseOf(days);
  return {
    exam,
    days,
    hours: Math.max(0, Math.floor(ms / 3_600_000)),
    phase,
    ...PHASE_COPY[phase],
  };
}

/** The exam that should be driving things: the soonest one still ahead. */
export function nextExam(exams: Exam[], now = new Date()): Exam | null {
  return (
    exams
      .filter((e) => !e.doneAt && new Date(e.at).getTime() > now.getTime() - 6 * 3_600_000)
      .sort((a, b) => a.at.localeCompare(b.at))[0] ?? null
  );
}

/** Whether the app is in exam mode at all. */
export function inExamMode(exams: Exam[], now = new Date()): boolean {
  const next = nextExam(exams, now);
  if (!next) return false;
  const days = daysUntil(next.at, now);
  return days <= EXAM_MODE_DAYS;
}

// ── store ──────────────────────────────────────────────────────────────────

export async function listExams(): Promise<Exam[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: false }).limit(60);
  return (data ?? [])
    .map((r) => ({ ...(r.payload as Omit<Exam, "id">), id: r.id as string }))
    .filter((e) => e.at);
}

export async function addExam(input: { subject: string; at: string; syllabus: string }): Promise<string | null> {
  if (!input.subject.trim() || !input.at) return null;
  const when = new Date(input.at);
  if (Number.isNaN(when.getTime())) return null;
  const id = crypto.randomUUID();
  await db.from("Event").insert({
    id, userId: DEFAULT_USER_ID, type: TYPE,
    payload: {
      subject: input.subject.trim().slice(0, 120),
      at: when.toISOString(),
      syllabus: input.syllabus.trim().slice(0, 20_000),
      at_created: new Date().toISOString(),
      doneAt: null,
    },
  });
  return id;
}

export async function markExamDone(id: string, done = true): Promise<void> {
  const { data } = await db.from("Event").select("payload").eq("id", id).eq("userId", DEFAULT_USER_ID).maybeSingle();
  if (!data) return;
  await db.from("Event")
    .update({ payload: { ...(data.payload as object), doneAt: done ? new Date().toISOString() : null } })
    .eq("id", id);
}

export async function deleteExam(id: string): Promise<void> {
  const { trashRow } = await import("@/core/ops/trash");
  await trashRow("Event", id);
}

// ── practice questions ─────────────────────────────────────────────────────

export interface PracticeQuestion {
  id: string;
  examId: string;
  question: string;
  /** Kept separate so the page can hide it until he has had a go. */
  answer: string;
  marks: number;
  topic: string;
  at: string;
  attemptedAt?: string | null;
}

export async function listQuestions(examId?: string, limit = 120): Promise<PracticeQuestion[]> {
  let q = db.from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", Q_TYPE);
  if (examId) q = q.eq("payload->>examId", examId);
  const { data } = await q.order("createdAt", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ ...(r.payload as Omit<PracticeQuestion, "id">), id: r.id as string }));
}

export async function markAttempted(id: string): Promise<void> {
  const { data } = await db.from("Event").select("payload").eq("id", id).eq("userId", DEFAULT_USER_ID).maybeSingle();
  if (!data) return;
  await db.from("Event")
    .update({ payload: { ...(data.payload as object), attemptedAt: new Date().toISOString() } })
    .eq("id", id);
}

const paperSchema = z.object({
  questions: z.array(z.object({
    question: z.string(),
    answer: z.string().describe("The mark-scheme answer: what a full-credit response contains"),
    marks: z.number().describe("Marks out of, typically 2 to 10"),
    topic: z.string().describe("Which part of the syllabus this comes from"),
  })),
});

/**
 * Generate a small set of practice questions from the syllabus.
 *
 * Five, not fifty. A wall of questions generated overnight goes unread exactly
 * like a wall of anything else, and each night's set arriving on its own is the
 * behaviour that gets used. Topics already covered are passed in and avoided,
 * so night four is not night one again.
 */
export async function generateQuestions(exam: Exam, count = 5): Promise<number> {
  const model = getModel("smart") ?? getModel("fast");
  if (!model || !exam.syllabus.trim()) return 0;

  const existing = await listQuestions(exam.id, 60);
  const covered = [...new Set(existing.map((q) => q.topic).filter(Boolean))].slice(0, 25);
  const days = daysUntil(exam.at);

  try {
    const { object } = await generateObject({
      model,
      schema: paperSchema,
      system:
        `You are setting practice questions for Gyaan's ${exam.subject} exam. ${HUMAN_RULES} ` +
        "Set questions that could plausibly appear on the real paper: they must be answerable from " +
        "the syllabus given and nothing else. Ask for reasoning and application, not recall of a " +
        "definition — a question whose answer is one remembered sentence tests nothing worth testing. " +
        "The answer field is a mark scheme: what a full-credit response must contain, not an essay.",
      prompt:
        `Exam in ${days} day(s).\n\n── Syllabus ──\n${exam.syllabus.slice(0, 12_000)}\n\n` +
        (covered.length ? `Already asked about: ${covered.join("; ")}. Cover different ground.\n\n` : "") +
        `Set ${count} questions.`,
    });

    let n = 0;
    for (const q of object.questions.slice(0, count)) {
      if (!q.question?.trim() || !q.answer?.trim()) continue;
      await db.from("Event").insert({
        id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: Q_TYPE,
        payload: {
          examId: exam.id,
          question: q.question.trim().slice(0, 2000),
          answer: q.answer.trim().slice(0, 4000),
          marks: Math.min(20, Math.max(1, Math.round(q.marks) || 4)),
          topic: (q.topic ?? "").trim().slice(0, 120),
          at: new Date().toISOString(),
          attemptedAt: null,
        },
      });
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * The night shift's exam job.
 *
 * Returns null when there is no exam close enough, which is the signal for the
 * night shift to do its usual work instead.
 */
export async function runExamNight(): Promise<{ subject: string; made: number; days: number } | null> {
  const exams = await listExams();
  const next = nextExam(exams);
  if (!next) return null;
  const days = daysUntil(next.at);
  if (days > EXAM_MODE_DAYS || days < 0) return null;

  const made = await generateQuestions(next);
  return made > 0 ? { subject: next.subject, made, days } : null;
}
