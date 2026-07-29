import { NextResponse } from "next/server";
import {
  listDays, listWorkouts, addWorkout, deleteWorkout, addReport,
  getGoals, setGoals, stepStreak, average, correlate, today, type Goals,
} from "@/core/health/store";
import { getLeetStats } from "@/infrastructure/integrations/leetcode";

export const dynamic = "force-dynamic";

const LEET_USER = process.env.LEETCODE_USERNAME ?? "gyaanshetty";

/** Full health dashboard payload: today, trends, workouts, goals, insights. */
export async function GET(req: Request) {
  const days = Math.min(180, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 30));
  const [series, workouts, goals, leet] = await Promise.all([
    listDays(days),
    listWorkouts(days),
    getGoals(),
    getLeetStats(LEET_USER).catch(() => null),
  ]);

  const todayKey = today();
  const todayMetrics = series.find((d) => d.day === todayKey) ?? null;

  // workouts done in the last 7 days, for the weekly target
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekKey = new Date(weekAgo).toISOString().slice(0, 10);
  const workoutsThisWeek = workouts.filter((w) => w.day >= weekKey).length;

  // Sleep debt over the last 7 *calendar* days (not the last 7 reports, which
  // could span a month), counting only nights that actually reported.
  const sleepDebt = series
    .filter((d) => d.day >= weekKey && d.sleepHours != null)
    .reduce((a, d) => a + (goals.sleepHours - (d.sleepHours as number)), 0);

  // does sleep track with how much he actually ships?
  const solvedByDay = leet?.calendar ?? {};
  const sleepVsSolved = correlate(series, "sleepHours", solvedByDay);
  const stepsVsSolved = correlate(series, "steps", solvedByDay);

  return NextResponse.json({
    ok: true,
    data: {
      today: todayMetrics,
      series,
      workouts,
      goals,
      workoutsThisWeek,
      streak: stepStreak(series, goals.steps),
      averages: {
        steps: average(series, "steps"),
        sleepHours: average(series, "sleepHours"),
        activeKcal: average(series, "activeKcal"),
        restingHr: average(series, "restingHr"),
        weightKg: average(series, "weightKg"),
      },
      sleepDebt,
      correlations: { sleepVsSolved, stepsVsSolved },
    },
  });
}

/** Manual entry: a metric report, a workout, or a goal change. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> & { entry?: string };

  if (body.entry === "workout") {
    const id = await addWorkout(body as never);
    return NextResponse.json({ ok: true, data: { id } });
  }
  if (body.entry === "goals") {
    const goals = await setGoals(body as Partial<Goals>);
    return NextResponse.json({ ok: true, data: goals });
  }

  const metrics = { ...body };
  delete metrics.entry; // routing key, not a metric
  if (!Object.keys(metrics).length) {
    return NextResponse.json({ ok: false, error: "nothing to record" }, { status: 400 });
  }
  await addReport(metrics);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteWorkout(id);
  return NextResponse.json({ ok: true });
}
