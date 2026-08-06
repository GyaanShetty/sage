import { tzDay } from "@/lib/config";

/**
 * Readiness, from a real model rather than a vibe.
 *
 * Most apps invent a score out of whatever they happen to have. This uses the
 * one thing sports science actually agrees on: the acute-to-chronic workload
 * ratio. Compare the last week's training load against the last month's
 * rolling average, and the ratio tells you whether you are ramping faster than
 * you have adapted to.
 *
 * The interesting finding it encodes — the "sweet spot" around 0.8-1.3, with
 * injury risk climbing sharply above ~1.5 — comes from Gabbett's work on
 * training load. It is contested at the edges and the exact thresholds vary by
 * sport, so this reports the ratio and its band rather than pretending to a
 * precision it does not have.
 *
 * Sleep is folded in separately rather than blended into one number, because
 * "you are under-recovered" and "you are ramping too fast" call for different
 * things, and averaging them into a single 0-100 hides which one is true.
 */

export interface LoadDay { day: string; load: number }

export interface Readiness {
  /** Mean daily load over the last 7 days. */
  acute: number;
  /** Mean daily load over the last 28 days — what the body has adapted to. */
  chronic: number;
  /** acute / chronic. Null until there is enough history to mean anything. */
  ratio: number | null;
  band: "detraining" | "sweet-spot" | "ramping" | "danger" | "unknown";
  /** Hours below target across the last week. Positive means owed sleep. */
  sleepDebt: number;
  /** Nights that actually reported, so thin data can say so. */
  nights: number;
  /** 0-100, honest about what it is: a rollup, not a measurement. */
  score: number | null;
  verdict: string;
  advice: string;
}

/** Chronic load needs four weeks; below that the ratio is noise. */
const CHRONIC_DAYS = 28;
const ACUTE_DAYS = 7;
const MIN_LOADED_DAYS = 10;

/**
 * Session load.
 *
 * Volume where it exists — kilograms moved is the honest measure for lifting —
 * and minutes as the fallback, scaled so an hour of cardio is not dwarfed by a
 * heavy session's five-digit tonnage.
 */
export function sessionLoad(w: { volumeKg?: number | null; minutes?: number | null; intensity?: string | null }): number {
  if (w.volumeKg && w.volumeKg > 0) return w.volumeKg / 100;
  const minutes = w.minutes ?? 0;
  // Borg-style: minutes × perceived intensity, the classic session-RPE.
  const rpe = w.intensity === "hard" ? 8 : w.intensity === "easy" ? 3 : 5;
  return (minutes * rpe) / 10;
}

/** Daily loads over a window, zero-filled — rest days are data, not gaps. */
export function dailyLoads(
  sessions: { day: string; load: number }[],
  days: number,
  from = new Date(),
): LoadDay[] {
  const byDay = new Map<string, number>();
  for (const s of sessions) byDay.set(s.day, (byDay.get(s.day) ?? 0) + s.load);

  const out: LoadDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = tzDay(from.getTime() - i * 86_400_000);
    out.push({ day, load: byDay.get(day) ?? 0 });
  }
  return out;
}

function bandFor(ratio: number): Readiness["band"] {
  if (ratio < 0.8) return "detraining";
  if (ratio <= 1.3) return "sweet-spot";
  if (ratio <= 1.5) return "ramping";
  return "danger";
}

export function computeReadiness(
  sessions: { day: string; load: number }[],
  sleep: { day: string; hours: number }[],
  sleepTarget: number,
  now = new Date(),
): Readiness {
  const window = dailyLoads(sessions, CHRONIC_DAYS, now);
  const acuteDays = window.slice(-ACUTE_DAYS);

  const acute = acuteDays.reduce((a, d) => a + d.load, 0) / ACUTE_DAYS;
  const chronic = window.reduce((a, d) => a + d.load, 0) / CHRONIC_DAYS;

  const loadedDays = window.filter((d) => d.load > 0).length;
  // A ratio built on three sessions is arithmetic, not information.
  const ratio = loadedDays >= MIN_LOADED_DAYS && chronic > 0 ? acute / chronic : null;
  const band = ratio === null ? "unknown" : bandFor(ratio);

  // Sleep over the last week only — a debt from a month ago has been paid or
  // become someone else's problem.
  const recentSleep = sleep.filter((s) => {
    const age = (now.getTime() - new Date(`${s.day}T12:00:00Z`).getTime()) / 86_400_000;
    return age >= 0 && age < 7;
  });
  const sleepDebt = recentSleep.reduce((a, s) => a + (sleepTarget - s.hours), 0);
  const nights = recentSleep.length;

  // ── the rollup ──────────────────────────────────────────────────────────
  // Deliberately only computed when both halves are known. A score that
  // silently means "we guessed the missing half" is worse than no score.
  let score: number | null = null;
  if (ratio !== null && nights >= 3) {
    // Distance from the middle of the sweet spot, in ratio units.
    const loadPenalty = Math.min(40, Math.abs(ratio - 1.05) * 55);
    const sleepPenalty = Math.min(40, Math.max(0, sleepDebt) * 5);
    score = Math.round(Math.max(0, 100 - loadPenalty - sleepPenalty));
  }

  const verdict =
    band === "unknown"
      ? `Not enough training history yet — ${loadedDays} of the last 28 days have a session on them, and the ratio needs ${MIN_LOADED_DAYS}.`
      : band === "danger"
        ? `Ramping hard: this week is ${ratio!.toFixed(2)}× what you have adapted to. Above about 1.5 is where injury rates climb.`
        : band === "ramping"
          ? `Ramping: ${ratio!.toFixed(2)}× your four-week average. Fine for a block, not for a month.`
          : band === "detraining"
            ? `Backing off: ${ratio!.toFixed(2)}× your average. A deload if you meant it, a drift if you didn't.`
            : `Load is where it should be — ${ratio!.toFixed(2)}× your four-week average.`;

  const advice =
    nights < 3
      ? "No sleep data this week, so this is training load only."
      : sleepDebt > 6
        ? `You are ${sleepDebt.toFixed(1)} hours down on sleep. That is the lever, not the training.`
        : band === "danger"
          ? "Take the next session easy, or take it off. The ratio comes down either way."
          : band === "detraining"
            ? "Room to add a session this week if you want one."
            : "Nothing to change. Keep it here.";

  return {
    acute: Math.round(acute * 10) / 10,
    chronic: Math.round(chronic * 10) / 10,
    ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
    band,
    sleepDebt: Math.round(sleepDebt * 10) / 10,
    nights,
    score,
    verdict,
    advice,
  };
}

/** Read it from his actual data. */
export async function readiness(): Promise<Readiness> {
  const { listDays, listWorkouts, getGoals } = await import("./store");
  const [days, workouts, goals] = await Promise.all([listDays(30), listWorkouts(30), getGoals()]);

  const sessions = workouts.map((w) => ({
    day: w.day,
    // Hevy rows carry the volume in a note rather than a field once
    // normalised, so minutes and intensity are the reliable path here.
    load: sessionLoad({ minutes: w.minutes, intensity: w.intensity }),
  }));

  const sleep = days
    .filter((d) => d.sleepHours != null)
    .map((d) => ({ day: d.day, hours: d.sleepHours as number }));

  return computeReadiness(sessions, sleep, goals.sleepHours);
}
