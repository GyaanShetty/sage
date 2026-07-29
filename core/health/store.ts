import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";

/** One day's merged health metrics. Any field may be missing. */
export interface DayMetrics {
  day: string;              // YYYY-MM-DD (IST)
  steps: number | null;
  sleepHours: number | null;
  activeKcal: number | null;
  restingHr: number | null;
  distanceKm: number | null;
  weightKg: number | null;
  waterMl: number | null;
}

export interface Workout {
  id: string;
  type: string;
  minutes: number;
  intensity: "easy" | "moderate" | "hard";
  kcal: number | null;
  note?: string | null;
  day: string;
}

export interface Goals {
  steps: number;
  sleepHours: number;
  activeKcal: number;
  waterMl: number;
  workoutsPerWeek: number;
}

export const DEFAULT_GOALS: Goals = {
  steps: 8000,
  sleepHours: 7.5,
  activeKcal: 400,
  waterMl: 2500,
  workoutsPerWeek: 4,
};

const REPORT = "health.report";
const WORKOUT = "health.workout";
const GOALS = "health.goals";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function dayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}

export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/**
 * Normalise one raw report payload. Shortcuts and manual entries use slightly
 * different key names for the same metric, so every alias funnels to one shape.
 */
function normalise(p: Record<string, unknown>): Partial<DayMetrics> {
  const sleepMin = num(p.sleepMinutes);
  return {
    steps: num(p.steps),
    sleepHours: sleepMin != null ? sleepMin / 60 : num(p.sleepHours ?? p.sleep),
    activeKcal: num(p.activeKcal ?? p.calories ?? p.kcal),
    restingHr: num(p.restingHr ?? p.hr ?? p.heartRate),
    distanceKm: num(p.distanceKm ?? p.distance),
    weightKg: num(p.weightKg ?? p.weight),
    waterMl: num(p.waterMl ?? p.water),
  };
}

/**
 * Merged daily metrics, oldest first. Reports can arrive piecemeal (Shortcuts
 * often posts one metric per request), so later values overwrite earlier ones
 * for the same day — except water, which accumulates.
 */
export async function listDays(days = 30): Promise<DayMetrics[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data } = await db
    .from("Event").select("payload, createdAt")
    .eq("userId", DEFAULT_USER_ID).eq("type", REPORT)
    .gte("createdAt", since.toISOString())
    .order("createdAt", { ascending: true }).limit(1000);

  const byDay = new Map<string, DayMetrics>();
  for (const row of data ?? []) {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    // an explicit day in the payload wins, so backfills land on the right date
    const day = typeof p.day === "string" ? p.day : dayOf(row.createdAt as string);
    const cur = byDay.get(day) ?? {
      day, steps: null, sleepHours: null, activeKcal: null,
      restingHr: null, distanceKm: null, weightKg: null, waterMl: null,
    };
    const n = normalise(p);
    for (const [k, v] of Object.entries(n) as [keyof DayMetrics, number | null][]) {
      if (v == null) continue;
      if (k === "waterMl") cur.waterMl = (cur.waterMl ?? 0) + v;
      else (cur[k] as number | null) = v;
    }
    byDay.set(day, cur);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Record a metric report (manual entry or backfill). */
export async function addReport(payload: Record<string, unknown>): Promise<void> {
  await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: REPORT,
    payload: { ...payload, day: payload.day ?? today() },
  });
}

export async function listWorkouts(days = 30): Promise<Workout[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data } = await db
    .from("Event").select("id, payload, createdAt")
    .eq("userId", DEFAULT_USER_ID).eq("type", WORKOUT)
    .gte("createdAt", since.toISOString())
    .order("createdAt", { ascending: false }).limit(200);
  return (data ?? []).map((r) => {
    const p = r.payload as Omit<Workout, "id">;
    return { id: r.id as string, ...p, day: p.day ?? dayOf(r.createdAt as string) };
  });
}

export async function addWorkout(w: Partial<Workout>): Promise<string> {
  const id = crypto.randomUUID();
  await db.from("Event").insert({
    id, userId: DEFAULT_USER_ID, type: WORKOUT,
    payload: {
      type: (w.type ?? "workout").slice(0, 40),
      minutes: Math.max(0, Number(w.minutes) || 0),
      intensity: (["easy", "moderate", "hard"] as const).includes(w.intensity as never) ? w.intensity : "moderate",
      kcal: Number.isFinite(Number(w.kcal)) ? Number(w.kcal) : null,
      note: w.note ?? null,
      day: w.day ?? today(),
    },
  });
  return id;
}

export async function deleteWorkout(id: string): Promise<void> {
  await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
}

export async function getGoals(): Promise<Goals> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", GOALS)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  return { ...DEFAULT_GOALS, ...((data?.payload as Partial<Goals>) ?? {}) };
}

export async function setGoals(g: Partial<Goals>): Promise<Goals> {
  const merged = { ...(await getGoals()), ...g };
  await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: GOALS, payload: merged,
  });
  return merged;
}

/** Consecutive days (ending today or yesterday) that met the step goal. */
export function stepStreak(days: DayMetrics[], goal: number): number {
  const byDay = new Map(days.map((d) => [d.day, d]));
  let streak = 0;
  const cursor = new Date();
  // allow today to be incomplete without breaking the streak
  if ((byDay.get(today())?.steps ?? 0) < goal) cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(cursor);
    const d = byDay.get(key);
    if (!d || (d.steps ?? 0) < goal) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Mean of a metric across the days that reported it. */
export function average(days: DayMetrics[], key: keyof DayMetrics): number | null {
  const vals = days.map((d) => d[key]).filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
}

/**
 * Pearson correlation between a health metric and an outcome series keyed by
 * day — e.g. does sleep actually track with how much he ships?
 */
export function correlate(days: DayMetrics[], key: keyof DayMetrics, outcome: Record<string, number>): { r: number; n: number } | null {
  const pairs: [number, number][] = [];
  for (const d of days) {
    const v = d[key];
    if (typeof v !== "number") continue;
    pairs.push([v, outcome[d.day] ?? 0]);
  }
  if (pairs.length < 5) return null;
  const n = pairs.length;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let num2 = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) {
    num2 += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : { r: num2 / den, n };
}
