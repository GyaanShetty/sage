import { NextResponse } from "next/server";
import { closeHealthDay } from "@/core/health/daily";
import { syncHevy } from "@/core/health/hevy";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * The 9pm tick (15:30 UTC = 21:00 IST).
 *
 * Separate from the morning cron because the point is the hour: closing the
 * day out at nine only means anything if it happens at nine. The morning job
 * runs at 03:00 UTC and would report on a day barely started.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const closed = await closeHealthDay().catch(() => null);
  // Catches an evening session before the day is written off as untrained.
  const hevy = await syncHevy().catch(() => ({ ok: false, added: 0, updated: 0 }));

  return NextResponse.json({ ok: true, closed, hevy });
}
