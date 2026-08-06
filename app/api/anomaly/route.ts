import { NextResponse } from "next/server";
import { detectAnomalies } from "@/core/anomaly";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** What is off compared with his own baselines. No thresholds, no model. */
export async function GET() {
  return NextResponse.json(
    { ok: true, data: { anomalies: await detectAnomalies().catch(() => []) } },
    { headers: { "cache-control": "no-store" } },
  );
}
