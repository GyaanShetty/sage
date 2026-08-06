import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { HUMAN_RULES, tzDay } from "@/lib/config";

/**
 * The night shift.
 *
 * The thing that made JARVIS feel like staff rather than software was that he
 * worked while Stark slept. Not "here is your to-do list at 8am" — actual work,
 * finished, waiting. That was impossible here until the heartbeat: two cron
 * invocations a day cannot hold a night shift.
 *
 * So this runs in the small hours and does three things a person would do if
 * you paid them to sit up:
 *
 *   1. Picks up a question you left unanswered and researches it properly.
 *   2. Prepares whatever the first real thing tomorrow is — reading the
 *      history with whoever it involves so you walk in knowing.
 *   3. Reads the whole system for what has quietly gone wrong: the budget
 *      running ahead, sleep debt accumulating, an application going stale, a
 *      decision owed a verdict.
 *
 * Discipline about quota matters here — this runs unattended, so it is capped
 * at one research run and one synthesis call per night, and it stays silent
 * rather than inventing work when there is nothing to do. A night shift that
 * manufactures busywork to look useful is worse than one that sleeps.
 */

const TYPE = "night.report";

export interface NightItem {
  kind: "answered" | "prepared" | "noticed";
  title: string;
  body: string;
  /** Where to go to act on it. */
  href?: string;
}

export interface NightReport {
  day: string;
  ranAt: string;
  greeting: string;
  items: NightItem[];
  /** Nothing worth doing is a legitimate outcome, and says so. */
  quiet: boolean;
}

/** The most recent night's work, for the morning. */
export async function latestNightReport(): Promise<NightReport | null> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  return (data?.payload as NightReport) ?? null;
}

/** An open question from the study log, oldest first — it has waited longest. */
async function oldestOpenQuestion(): Promise<{ id: string; text: string } | null> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", "education.log")
    .order("createdAt", { ascending: true }).limit(200);

  for (const row of data ?? []) {
    const p = row.payload as { kind?: string; text?: string; resolvedAt?: string | null };
    if (p?.kind === "question" && !p.resolvedAt && p.text) {
      return { id: row.id as string, text: p.text };
    }
  }
  return null;
}

/**
 * Research one open question and file the answer against it.
 *
 * Deliberately one per night. Answering six questions at 3am produces a wall
 * of text nobody reads, and burns a day's quota before breakfast.
 */
async function answerOpenQuestion(): Promise<NightItem | null> {
  // With an exam close, the useful overnight work changes. Researching
  // whatever he last wondered about is a luxury in the fortnight before a
  // paper; a fresh set of practice questions off the syllabus is not.
  const { runExamNight } = await import("@/core/exam");
  const exam = await runExamNight().catch(() => null);
  if (exam) {
    return {
      kind: "answered",
      title: `${exam.made} practice questions for ${exam.subject}`,
      body: `${exam.days} day${exam.days === 1 ? "" : "s"} to go. Closed-book, then check — the checking is where the learning is.`,
      href: "/exam",
    };
  }

  const question = await oldestOpenQuestion();
  if (!question) return null;

  const { research } = await import("@/core/research/deep");
  const brief = await research(question.text).catch(() => null);
  if (!brief || "error" in brief) return null;

  return {
    kind: "answered",
    title: question.text.slice(0, 120),
    body: brief.summary?.slice(0, 600) ?? "Researched — the brief is saved.",
    href: "/read",
  };
}

/**
 * Prepare for tomorrow's first real commitment.
 *
 * "Real" excludes all-day entries, which are labels on a date rather than
 * things you walk into. The useful preparation is not the time — you can read
 * that yourself — it is the history: what was last said, and by whom.
 */
async function prepareTomorrow(): Promise<NightItem | null> {
  const { upcomingEvents } = await import("@/core/calendar");
  const events = await upcomingEvents(10, 2).catch(() => []);
  const next = events.find((e) => !e.allDay && e.start);
  if (!next) return null;

  const when = new Date(next.start);
  // Only worth preparing if it is actually within the next day.
  if (when.getTime() - Date.now() > 36 * 3_600_000) return null;

  const lines: string[] = [];

  // Anyone named in the title is worth looking up in the mailbox.
  const { searchGmail } = await import("@/infrastructure/integrations/google");
  const subject = next.summary.replace(/\b(meeting|call|sync|interview|with)\b/gi, " ").trim();
  if (subject.length > 2) {
    const mail = await searchGmail(`newer_than:120d "${subject.slice(0, 40)}"`, 3).catch(() => null);
    for (const m of mail ?? []) lines.push(`${m.subject} — ${m.snippet.slice(0, 140)}`);
  }

  // And in what SAGE already knows about him.
  const { recallWithin } = await import("@/core/memory/recall");
  const memories = await recallWithin(next.summary, 4, 4000).catch(() => []);
  for (const m of memories) lines.push(m.content.slice(0, 160));

  if (lines.length === 0) return null;

  return {
    kind: "prepared",
    title: `${next.summary} · ${when.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit" })}`,
    body: lines.slice(0, 5).join("\n"),
    href: "/dashboard",
  };
}

/**
 * What has quietly gone wrong.
 *
 * Everything here is already visible on some page; the point is that nobody
 * visits six pages at once, so a thing that only shows up on the page you did
 * not open is a thing that does not exist.
 */
async function whatSlipped(): Promise<string[]> {
  const notes: string[] = [];

  await Promise.all([
    // Departures from his own patterns, which thresholds cannot see.
    (async () => {
      const { detectAnomalies } = await import("@/core/anomaly");
      for (const a of await detectAnomalies(2)) notes.push(a.detail);
    })().catch(() => undefined),

    (async () => {
      const { getPlan, budgetStatus, currentMonth } = await import("@/core/finance/budget");
      const { listExpenses } = await import("@/core/finance/expenses");
      const plan = await getPlan(currentMonth());
      if (!plan) return;
      const status = budgetStatus(plan, await listExpenses(60));
      const over = status.lines.filter((l) => l.state === "over");
      const watch = status.lines.filter((l) => l.state === "watch");
      if (over.length) notes.push(`Over budget on ${over.map((l) => l.category).join(", ")}.`);
      else if (watch.length) notes.push(`On pace to overshoot ${watch.map((l) => l.category).join(", ")} this month.`);
    })().catch(() => undefined),

    (async () => {
      const { listDecisions, dueForReview } = await import("@/core/decisions/store");
      const due = dueForReview(await listDecisions());
      if (due.length) notes.push(`${due.length} decision${due.length === 1 ? "" : "s"} owed a verdict — oldest: "${due[0].title}".`);
    })().catch(() => undefined),

    (async () => {
      const { listDays, getGoals } = await import("@/core/health/store");
      const [days, goals] = await Promise.all([listDays(7), getGoals()]);
      const slept = days.filter((d) => d.sleepHours != null);
      if (slept.length >= 3) {
        const debt = slept.reduce((a, d) => a + (goals.sleepHours - (d.sleepHours as number)), 0);
        if (debt > 4) notes.push(`Sleep debt is ${debt.toFixed(1)} hours across the last week.`);
      }
      const logged = days.filter((d) => d.steps != null).length;
      if (logged === 0) notes.push("No health data has arrived in a week — the Shortcut may have stopped.");
    })().catch(() => undefined),

    (async () => {
      const { data } = await db
        .from("Task").select("id, title, dueAt")
        .eq("userId", DEFAULT_USER_ID).neq("status", "done").neq("status", "cancelled")
        .lt("dueAt", new Date().toISOString()).limit(10);
      if (data?.length) notes.push(`${data.length} task${data.length === 1 ? "" : "s"} overdue — oldest: "${data[0].title}".`);
    })().catch(() => undefined),
  ]);

  return notes;
}

const voiceSchema = z.object({
  greeting: z.string().describe("One or two sentences, as a chief of staff reporting on the night's work"),
});

export async function runNightShift(): Promise<NightReport> {
  const day = tzDay();
  const items: NightItem[] = [];

  const [answered, prepared, slipped] = await Promise.all([
    answerOpenQuestion().catch(() => null),
    prepareTomorrow().catch(() => null),
    whatSlipped().catch(() => [] as string[]),
  ]);

  if (answered) items.push(answered);
  if (prepared) items.push(prepared);
  for (const note of slipped) {
    items.push({ kind: "noticed", title: note, body: "" });
  }

  const quiet = items.length === 0;

  // Nothing happened is a real answer, and does not need a model to say it.
  let greeting = quiet
    ? "A quiet night, sir. Nothing needed doing that couldn't wait for you."
    : "";

  if (!quiet) {
    const model = getModel("fast");
    if (model) {
      try {
        const { object } = await generateObject({
          model,
          schema: voiceSchema,
          system:
            `You are SAGE, Gyaan's chief of staff, telling him what you did overnight. ${HUMAN_RULES} ` +
            "Two sentences at most. Say what you actually did, not what you could do. " +
            "No 'I hope this helps', no listing — the list is shown beneath you. Understated.",
          prompt: items.map((i) => `[${i.kind}] ${i.title}${i.body ? `: ${i.body.slice(0, 200)}` : ""}`).join("\n"),
        });
        greeting = object.greeting;
      } catch {
        greeting = `${items.length} thing${items.length === 1 ? "" : "s"} while you slept, sir.`;
      }
    } else {
      greeting = `${items.length} thing${items.length === 1 ? "" : "s"} while you slept, sir.`;
    }
  }

  const report: NightReport = { day, ranAt: new Date().toISOString(), greeting, items, quiet };

  await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE, payload: report,
  }).then(() => undefined, () => undefined);

  return report;
}
