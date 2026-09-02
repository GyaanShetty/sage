import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { machineAuth } from "@/lib/security";

/**
 * Receiver for iPhone Shortcuts (or anything else) posting daily health data.
 * Auth: ?key=CRON_SECRET or Authorization: Bearer CRON_SECRET.
 *
 * Body: any JSON. Recognised keys, with the aliases Apple Health's own field
 * names arrive under from Shortcuts:
 *
 *   steps                                  step count
 *   sleepHours | sleepMinutes | sleep      time asleep
 *   activeKcal | calories | kcal           energy BURNED
 *   dietaryKcal | dietaryEnergy            energy CONSUMED — MyFitnessPal
 *                | caloriesConsumed        writes this into Apple Health
 *   proteinG | protein                     protein consumed
 *   restingHr | hr | heartRate             resting heart rate
 *   spo2 | oxygenSaturation | bloodOxygen  blood oxygen
 *   waterMl | water                        water; accumulates within a day
 *   weightKg | weight, distanceKm | distance
 *
 * Unknown keys are stored as-is, so a shortcut can post more than SAGE reads
 * today without the data being lost.
 *
 * Shortcuts commonly posts one metric per request; the store merges by IST
 * day, so several small posts through the day are fine and are in fact easier
 * to build than one that gathers everything.
 */
export async function POST(req: Request) {
  if (!machineAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  await ensureDefaultUser();
  const { error } = await db.from("Event").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    type: "health.report",
    payload,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
