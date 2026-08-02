import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { fetchHevyWorkouts, summariseWorkout, hevyConfigured, type WorkoutSummary } from "@/infrastructure/integrations/hevy";

/**
 * Bring Hevy workouts into SAGE.
 *
 * Stored as health.workout events, the same type the Health page and the life
 * report already read, so training shows up everywhere without any of those
 * needing to know Hevy exists.
 *
 * Idempotent by external id: re-syncing the same workout updates it rather than
 * filing a duplicate, which matters because Hevy lets you edit a session after
 * saving it.
 */

const TYPE = "health.workout";

async function existingExternalIds(): Promise<Map<string, string>> {
  const { data } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .limit(500);
  const map = new Map<string, string>();
  for (const r of data ?? []) {
    const ext = (r.payload as { externalId?: string })?.externalId;
    if (ext) map.set(ext, r.id as string);
  }
  return map;
}

export async function storeWorkouts(workouts: WorkoutSummary[]): Promise<{ added: number; updated: number }> {
  if (workouts.length === 0) return { added: 0, updated: 0 };
  const seen = await existingExternalIds();
  let added = 0;
  let updated = 0;

  for (const w of workouts) {
    const existing = seen.get(w.externalId);
    // `kind` and `minutes` keep the shape the rest of the app already expects;
    // everything else is additive.
    const payload = { ...w, kind: w.title, at: w.at };
    if (existing) {
      await db.from("Event").update({ payload }).eq("id", existing);
      updated += 1;
    } else {
      await db.from("Event").insert({
        id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE, payload,
      });
      added += 1;
    }
  }
  return { added, updated };
}

export async function syncHevy(): Promise<{ ok: boolean; added: number; updated: number; reason?: string }> {
  if (!hevyConfigured()) {
    return { ok: false, added: 0, updated: 0, reason: "No HEVY_API_KEY set. Hevy's API is a Pro feature — or import a CSV export instead." };
  }
  const raw = await fetchHevyWorkouts(3, 10);
  if (!raw) return { ok: false, added: 0, updated: 0, reason: "Hevy rejected the key or was unreachable." };
  const { added, updated } = await storeWorkouts(raw.map(summariseWorkout));
  return { ok: true, added, updated };
}

export interface TrainingSummary {
  workouts: number;
  totalVolumeKg: number;
  totalMinutes: number;
  perWeek: number;
  topExercises: { name: string; sets: number; bestKg: number | null }[];
  lastAt: string | null;
}

/** Training over a window, for the Health page and the life report. */
export async function trainingSummary(days = 30): Promise<TrainingSummary> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(300);

  const rows = (data ?? [])
    .map((r) => r.payload as Partial<WorkoutSummary>)
    .filter((w) => (w.at ?? "") >= since);

  const byExercise = new Map<string, { sets: number; best: number | null }>();
  let volume = 0;
  let minutes = 0;
  for (const w of rows) {
    volume += w.volumeKg ?? 0;
    minutes += w.minutes ?? 0;
    for (const ex of w.exercises ?? []) {
      const e = byExercise.get(ex.name) ?? { sets: 0, best: null as number | null };
      e.sets += ex.sets;
      if (ex.topSetKg != null && (e.best === null || ex.topSetKg > e.best)) e.best = ex.topSetKg;
      byExercise.set(ex.name, e);
    }
  }

  return {
    workouts: rows.length,
    totalVolumeKg: Math.round(volume),
    totalMinutes: minutes,
    perWeek: Number(((rows.length / days) * 7).toFixed(1)),
    topExercises: [...byExercise.entries()]
      .sort((a, b) => b[1].sets - a[1].sets)
      .slice(0, 8)
      .map(([name, v]) => ({ name, sets: v.sets, bestKg: v.best })),
    lastAt: rows[0]?.at ?? null,
  };
}
