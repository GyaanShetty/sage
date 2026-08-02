import { NextResponse } from "next/server";
import { syncHevy, storeWorkouts, trainingSummary } from "@/core/health/hevy";
import { parseHevyCsv } from "@/infrastructure/integrations/hevy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Training summary over a window. */
export async function GET(req: Request) {
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 30)));
  return NextResponse.json({ ok: true, data: await trainingSummary(days) });
}

/**
 * POST with no body → pull from the Hevy API.
 * POST multipart with `file` → import a Hevy CSV export, which needs no Pro
 * subscription and is the path that works for everyone.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "file required" }, { status: 400 });
    const csv = await file.text();
    const workouts = parseHevyCsv(csv);
    if (workouts.length === 0) {
      return NextResponse.json({ ok: false, error: "No workouts found — is this a Hevy CSV export?" }, { status: 400 });
    }
    const res = await storeWorkouts(workouts);
    return NextResponse.json({ ok: true, data: { ...res, parsed: workouts.length, via: "csv" } });
  }

  const res = await syncHevy();
  if (!res.ok) return NextResponse.json({ ok: false, error: res.reason }, { status: 400 });
  return NextResponse.json({ ok: true, data: { ...res, via: "api" } });
}
