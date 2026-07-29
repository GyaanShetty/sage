import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { listDays, listWorkouts, getGoals, average, stepStreak } from "@/core/health/store";
import { getWeather } from "@/infrastructure/weather";
import { HUMAN_RULES } from "@/lib/config";

export const maxDuration = 45;

/**
 * Health coach — reads the last month of metrics and answers in SAGE's voice.
 * Grounded strictly in the user's own numbers; refuses to invent data it
 * doesn't have rather than guessing.
 */
export async function POST(req: Request) {
  const { question } = (await req.json().catch(() => ({}))) as { question?: string };

  const model = getModel("smart") ?? getModel("fast");
  if (!model) return NextResponse.json({ ok: false, error: "no model" }, { status: 400 });

  const [series, workouts, goals, weather] = await Promise.all([
    listDays(30),
    listWorkouts(30),
    getGoals(),
    getWeather().catch(() => null),
  ]);

  if (!series.length) {
    return NextResponse.json({
      ok: true,
      data: { answer: "I've no health data to work with yet, sir. Log a day manually, or point your iPhone Shortcut at the health webhook and I'll start building a picture." },
    });
  }

  const recent = series.slice(-10)
    .map((d) => `${d.day}: ${d.steps ?? "?"} steps, ${d.sleepHours?.toFixed(1) ?? "?"}h sleep, ${d.activeKcal ?? "?"} kcal, RHR ${d.restingHr ?? "?"}`)
    .join("\n");
  const workoutLines = workouts.slice(0, 8)
    .map((w) => `${w.day}: ${w.type} ${w.minutes}min (${w.intensity})`)
    .join("\n") || "(none logged)";

  const avgs = [
    `steps ${average(series, "steps")?.toFixed(0) ?? "?"}`,
    `sleep ${average(series, "sleepHours")?.toFixed(1) ?? "?"}h`,
    `active ${average(series, "activeKcal")?.toFixed(0) ?? "?"} kcal`,
    `RHR ${average(series, "restingHr")?.toFixed(0) ?? "?"}`,
  ].join(", ");

  const { text } = await generateText({
    model,
    system:
      `You are SAGE, Gyaan's chief of staff, advising on his health. ${HUMAN_RULES} ` +
      "Ground every claim in the numbers given — quote the actual figures. If the data doesn't support an answer, say so plainly instead of speculating. Be direct about what's slipping and specific about the next action. Under 140 words. No markdown, no bullet lists, no medical disclaimers — you're a trusted aide, not a liability form. You are not a doctor; if something looks genuinely concerning, tell him to see one.",
    prompt: [
      question?.trim() ? `His question: "${question.trim()}"` : "Give him a short read on how his health is trending and the one thing to fix.",
      ``,
      `Goals: ${goals.steps} steps/day, ${goals.sleepHours}h sleep, ${goals.activeKcal} active kcal, ${goals.workoutsPerWeek} workouts/week.`,
      `30-day averages: ${avgs}. Step-goal streak: ${stepStreak(series, goals.steps)} days.`,
      ``,
      `Last 10 days:\n${recent}`,
      ``,
      `Recent workouts:\n${workoutLines}`,
      weather?.aqi != null ? `\nToday's AQI where he is: ${weather.aqi}.` : "",
    ].join("\n"),
  });

  return NextResponse.json({ ok: true, data: { answer: text.trim() } });
}
