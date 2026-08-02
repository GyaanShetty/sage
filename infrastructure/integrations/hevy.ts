import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Hevy — strength training.
 *
 * The public profile page (hevy.com/user/<name>) carries nothing but a username
 * and an avatar; the workouts are fetched client-side from an endpoint that
 * answers 401 to anyone without a session. So "it's public" is true of the page
 * and not of the data, and scraping it would mean borrowing a login — fragile
 * and against their terms.
 *
 * The supported route is Hevy's own developer API, which authenticates with an
 * `api-key` header. It is a Pro feature; a key comes from
 * hevy.com/settings?developer. Without one, the CSV export path in
 * core/health/hevy.ts covers the same ground manually.
 */

const API = "https://api.hevyapp.com/v1";

export interface HevySet {
  type?: string;
  weight_kg?: number | null;
  reps?: number | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  rpe?: number | null;
}
export interface HevyExercise {
  title?: string;
  notes?: string | null;
  sets?: HevySet[];
}
export interface HevyWorkout {
  id: string;
  title?: string;
  description?: string | null;
  start_time?: string;
  end_time?: string;
  updated_at?: string;
  exercises?: HevyExercise[];
}

export function hevyConfigured(): boolean {
  return !!process.env.HEVY_API_KEY;
}

async function call<T>(path: string): Promise<T | null> {
  const key = process.env.HEVY_API_KEY;
  if (!key) return null;
  try {
    const res = await proxyFetch(`${API}${path}`, {
      headers: { "api-key": key, accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Most recent workouts, newest first. Paged because Hevy caps page size. */
export async function fetchHevyWorkouts(pages = 2, pageSize = 10): Promise<HevyWorkout[] | null> {
  if (!hevyConfigured()) return null;
  const out: HevyWorkout[] = [];
  for (let page = 1; page <= pages; page++) {
    const data = await call<{ workouts?: HevyWorkout[] }>(`/workouts?page=${page}&pageSize=${pageSize}`);
    if (!data?.workouts?.length) break;
    out.push(...data.workouts);
    if (data.workouts.length < pageSize) break; // last page
  }
  return out;
}

export interface WorkoutSummary {
  externalId: string;
  title: string;
  at: string;
  minutes: number;
  /** Σ weight × reps, in kg. The single most useful number for progression. */
  volumeKg: number;
  sets: number;
  reps: number;
  exercises: { name: string; sets: number; topSetKg: number | null }[];
  source: "hevy";
}

/** Reduce a raw Hevy workout to the figures worth storing and charting. */
export function summariseWorkout(w: HevyWorkout): WorkoutSummary {
  let volumeKg = 0;
  let sets = 0;
  let reps = 0;
  const exercises: WorkoutSummary["exercises"] = [];

  for (const ex of w.exercises ?? []) {
    let exSets = 0;
    let top: number | null = null;
    for (const s of ex.sets ?? []) {
      // Warm-up sets still count as work done; excluding them would understate
      // volume in a way the app never explains.
      exSets += 1;
      sets += 1;
      const r = s.reps ?? 0;
      const kg = s.weight_kg ?? 0;
      reps += r;
      volumeKg += kg * r;
      if (kg > 0 && (top === null || kg > top)) top = kg;
    }
    if (ex.title) exercises.push({ name: ex.title, sets: exSets, topSetKg: top });
  }

  const start = w.start_time ? new Date(w.start_time).getTime() : Date.now();
  const end = w.end_time ? new Date(w.end_time).getTime() : start;
  return {
    externalId: w.id,
    title: w.title?.trim() || "Workout",
    at: new Date(start).toISOString(),
    minutes: Math.max(0, Math.round((end - start) / 60_000)),
    volumeKg: Math.round(volumeKg),
    sets,
    reps,
    exercises: exercises.slice(0, 20),
    source: "hevy",
  };
}

/**
 * Hevy's CSV export, for accounts without Pro.
 *
 * One row per SET, not per workout, so rows are grouped by start time. Header
 * names have changed across app versions, hence matching on substrings rather
 * than exact equality — a rename should degrade one column, not the import.
 */
export function parseHevyCsv(csv: string): WorkoutSummary[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const split = (line: string): string[] => {
    // Quoted fields may contain commas — exercise notes routinely do.
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (c === "," && !quoted) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };

  /**
   * Hevy writes dates as "Jul 29, 2026 at 6:00 PM" — not ISO, and the " at "
   * makes Date() reject the whole string. Some exports (and the API) do use
   * ISO, so both are accepted and anything unparseable is skipped rather than
   * silently becoming 1970.
   */
  const parseWhen = (raw: string): Date | null => {
    const t = raw.trim().replace(/^"|"$/g, "");
    if (!t) return null;
    const direct = new Date(t.includes("T") ? t : t.replace(" at ", " "));
    if (!Number.isNaN(direct.getTime())) return direct;
    const iso = new Date(t.replace(" ", "T"));
    return Number.isNaN(iso.getTime()) ? null : iso;
  };

  const header = split(lines[0]).map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iStart = col("start_time", "start time", "date");
  const iEnd = col("end_time", "end time");
  const iTitle = col("title", "workout name");
  const iExercise = col("exercise_title", "exercise name", "exercise");
  const iWeight = col("weight_kg", "weight");
  const iReps = col("reps");
  if (iStart < 0) return [];

  const byWorkout = new Map<string, WorkoutSummary & { _ex: Map<string, { sets: number; top: number | null }> }>();

  for (const line of lines.slice(1)) {
    const f = split(line);
    const cell = (i: number) => (i >= 0 ? (f[i] ?? "").trim().replace(/^"|"$/g, "") : "");
    const startRaw = cell(iStart);
    if (!startRaw) continue;
    const started = parseWhen(startRaw);
    if (!started) continue;
    const key = started.toISOString();

    let w = byWorkout.get(key);
    if (!w) {
      const endRaw = cell(iEnd);
      const ended = (endRaw ? parseWhen(endRaw) : null) ?? started;
      w = {
        externalId: `csv-${key}`,
        title: cell(iTitle) || "Workout",
        at: key,
        minutes: Math.max(0, Math.round((ended.getTime() - started.getTime()) / 60_000)),
        volumeKg: 0, sets: 0, reps: 0, exercises: [], source: "hevy",
        _ex: new Map(),
      };
      byWorkout.set(key, w);
    }

    const kg = Number(cell(iWeight)) || 0;
    const reps = Number(cell(iReps)) || 0;
    w.sets += 1;
    w.reps += reps;
    w.volumeKg += kg * reps;

    const name = cell(iExercise) || "Exercise";
    const ex = w._ex.get(name) ?? { sets: 0, top: null as number | null };
    ex.sets += 1;
    if (kg > 0 && (ex.top === null || kg > ex.top)) ex.top = kg;
    w._ex.set(name, ex);
  }

  return [...byWorkout.values()]
    .map(({ _ex, ...w }) => ({
      ...w,
      volumeKg: Math.round(w.volumeKg),
      exercises: [..._ex.entries()].slice(0, 20).map(([name, v]) => ({ name, sets: v.sets, topSetKg: v.top })),
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
