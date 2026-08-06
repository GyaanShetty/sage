import { NextResponse } from "next/server";
import { latestNightReport, runNightShift } from "@/core/night/shift";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Last night's work. */
export async function GET() {
  return NextResponse.json({ ok: true, data: { report: await latestNightReport().catch(() => null) } });
}

/** Run it now — useful for seeing what it does without waiting for 3am. */
export async function POST() {
  const report = await runNightShift().catch((e: Error) => ({ error: e.message }));
  if ("error" in report) return NextResponse.json({ ok: false, error: report.error }, { status: 500 });
  return NextResponse.json({ ok: true, data: { report } });
}
