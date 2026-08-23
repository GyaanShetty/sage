import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { machineAuth } from "@/lib/security";

/**
 * Receiver for iPhone Shortcuts (or anything else) posting daily health data.
 * Auth: ?key=CRON_SECRET or Authorization: Bearer CRON_SECRET.
 *
 * Body: any JSON — expected keys: steps, sleepHours, activeKcal, restingHr,
 * distanceKm, battery. Unknown keys are stored as-is.
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
