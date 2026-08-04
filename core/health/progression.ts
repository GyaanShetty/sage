import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import type { WorkoutSummary } from "@/infrastructure/integrations/hevy";

/**
 * Are you actually getting stronger?
 *
 * The training panel could say how much you lifted and how often. Neither
 * answers the only question that matters over months, which is whether the
 * numbers are going up — and on which lifts they are not.
 *
 * Everything here is derived from the workouts already stored, so it costs one
 * query and no new logging.
 */

// Shared with manually logged sessions, which have no `exercises` or `at` —
// the payload filter below keeps those out rather than counting them as
// zero-volume training.
const TYPE = "health.workout";

async function loadWorkouts(days: number): Promise<WorkoutSummary[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .gte("payload->>at", since)
    .order("createdAt", { ascending: false })
    .limit(400);
  return (data ?? []).map((r) => r.payload as WorkoutSummary).filter((w) => w?.at);
}

export interface LiftProgress {
  name: string;
  sessions: number;
  /** Heaviest set ever recorded in the window. */
  bestKg: number | null;
  /** Heaviest set in the most recent session that included this lift. */
  latestKg: number | null;
  /** Change from the first session in the window to the latest, in kg. */
  changeKg: number | null;
  changePct: number | null;
  /** Estimated one-rep max at the best set, Epley. */
  e1rm: number | null;
  trend: "up" | "flat" | "down" | "new";
  lastTrained: string;
  /** Days since it was last trained — the number that spots a neglected lift. */
  daysSince: number;
}

/**
 * Epley: 1RM ≈ w × (1 + reps/30).
 *
 * A weight lifted for eight reps is a bigger lift than the same weight for
 * three, and comparing top-set kilos alone hides that entirely. The formula is
 * an estimate and drifts above ~10 reps, which is why it is reported beside the
 * real number rather than instead of it.
 */
export function epley(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  return Math.round(weightKg * (1 + reps / 30));
}

export interface PersonalRecord {
  lift: string;
  kg: number;
  at: string;
  /** The previous best this beat, if there was one. */
  previousKg: number | null;
  daysAgo: number;
}

export interface TrainingProgress {
  /** Bests set in the window, newest first. */
  records: PersonalRecord[];
  lifts: LiftProgress[];
  /** Weekly volume, oldest first — the shape of the training block. */
  weeklyVolume: { week: string; volumeKg: number; sessions: number }[];
  /** Lifts trained before but not in the last three weeks. */
  neglected: LiftProgress[];
  notes: string[];
}

export async function trainingProgress(days = 120): Promise<TrainingProgress> {
  const workouts = (await loadWorkouts(days)).sort((a, b) => a.at.localeCompare(b.at));
  const now = Date.now();

  // ── Per-lift ────────────────────────────────────────────────────────────
  const byLift = new Map<string, { at: string; topKg: number | null }[]>();
  for (const w of workouts) {
    for (const ex of w.exercises ?? []) {
      const list = byLift.get(ex.name) ?? [];
      list.push({ at: w.at, topKg: ex.topSetKg });
      byLift.set(ex.name, list);
    }
  }

  const lifts: LiftProgress[] = [...byLift.entries()].map(([name, sessions]) => {
    const weighted = sessions.filter((s) => (s.topKg ?? 0) > 0);
    const first = weighted[0]?.topKg ?? null;
    const latest = weighted.at(-1)?.topKg ?? null;
    const bestKg = weighted.length ? Math.max(...weighted.map((s) => s.topKg as number)) : null;

    const changeKg = first != null && latest != null ? Math.round((latest - first) * 10) / 10 : null;
    const changePct = first && latest ? Math.round(((latest - first) / first) * 100) : null;

    // One session is a data point, not a trend, and calling it "flat" would
    // imply a comparison that has not happened.
    const trend: LiftProgress["trend"] =
      weighted.length < 2 ? "new"
      : (changeKg ?? 0) > 0.5 ? "up"
      : (changeKg ?? 0) < -0.5 ? "down"
      : "flat";

    const lastTrained = sessions.at(-1)?.at ?? "";
    return {
      name,
      sessions: sessions.length,
      bestKg,
      latestKg: latest,
      changeKg,
      changePct,
      // Reps per set are not stored per exercise, so the estimate uses a
      // conventional 8. Reported as an estimate, never as a measurement.
      e1rm: bestKg ? epley(bestKg, 8) : null,
      trend,
      lastTrained,
      daysSince: lastTrained ? Math.floor((now - new Date(lastTrained).getTime()) / 86_400_000) : 999,
    };
  })
  .sort((a, b) => b.sessions - a.sessions);

  // ── Personal records ────────────────────────────────────────────────────
  // A best is only a record if it beat something. The first time a lift
  // appears it sets the bar rather than clearing it, so counting that as a PR
  // would fill the list with "records" on the day you started tracking.
  const records: PersonalRecord[] = [];
  for (const [name, sessions] of byLift) {
    let best = 0;
    for (const s of sessions) {
      const kg = s.topKg ?? 0;
      if (kg <= 0) continue;
      if (best > 0 && kg > best) {
        records.push({
          lift: name,
          kg,
          at: s.at,
          previousKg: best,
          daysAgo: Math.floor((now - new Date(s.at).getTime()) / 86_400_000),
        });
      }
      if (kg > best) best = kg;
    }
  }
  records.sort((a, b) => b.at.localeCompare(a.at));

  // ── Weekly volume ───────────────────────────────────────────────────────
  const weeks = new Map<string, { volumeKg: number; sessions: number }>();
  for (const w of workouts) {
    const d = new Date(w.at);
    // ISO-ish week key: Monday of that week, so weeks compare like for like.
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const cur = weeks.get(key) ?? { volumeKg: 0, sessions: 0 };
    cur.volumeKg += w.volumeKg ?? 0;
    cur.sessions += 1;
    weeks.set(key, cur);
  }
  const weeklyVolume = [...weeks.entries()]
    .map(([week, v]) => ({ week, volumeKg: Math.round(v.volumeKg), sessions: v.sessions }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // A lift trained more than once and then dropped for three weeks is the
  // thing that quietly falls out of a programme.
  const neglected = lifts.filter((l) => l.sessions >= 2 && l.daysSince >= 21).slice(0, 5);

  const notes: string[] = [];
  const climbing = lifts.filter((l) => l.trend === "up");
  const falling = lifts.filter((l) => l.trend === "down" && l.sessions >= 3);

  if (climbing.length) {
    const best = [...climbing].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))[0];
    notes.push(`${best.name} is up ${best.changeKg}kg (${best.changePct}%) over the window — the clearest progress you have.`);
  }
  if (falling.length) {
    notes.push(`Going backwards on ${falling.slice(0, 3).map((l) => l.name).join(", ")}. Worth checking whether that is fatigue or programming.`);
  }
  if (neglected.length) {
    notes.push(`${neglected.map((l) => l.name).join(", ")} — trained before, untouched for three weeks or more.`);
  }
  if (weeklyVolume.length >= 3) {
    const last = weeklyVolume.at(-1)!;
    const prior = weeklyVolume.slice(-4, -1);
    const avg = prior.reduce((a, w) => a + w.volumeKg, 0) / Math.max(1, prior.length);
    if (avg > 0 && last.volumeKg < avg * 0.6) {
      notes.push(`Last week's volume was ${Math.round((1 - last.volumeKg / avg) * 100)}% below the recent average — a deload, or a slip?`);
    }
  }

  const recent = records.filter((r) => r.daysAgo <= 14);
  if (recent.length) {
    const top = recent[0];
    notes.push(`New best on ${top.lift}: ${top.kg}kg, up from ${top.previousKg}kg${top.daysAgo === 0 ? " today" : `, ${top.daysAgo}d ago`}.`);
  }

  return { records: records.slice(0, 12), lifts, weeklyVolume, neglected, notes };
}
