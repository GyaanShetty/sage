import { NextResponse } from "next/server";
import { buildSitrep } from "@/core/sitrep";
import { latestNightReport } from "@/core/night/shift";
import { detectAnomalies } from "@/core/anomaly";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * The live readout. Polled, so it must stay cheap and must never cache —
 * a status board showing a minute-old number is worse than one that says
 * nothing, because you would act on it.
 */
export async function GET() {
  const [sitrep, night, anomalies] = await Promise.all([
    buildSitrep(),
    latestNightReport().catch(() => null),
    // Departures from his own baselines, which no threshold on the board
    // above would ever catch.
    detectAnomalies().catch(() => []),
  ]);

  return NextResponse.json(
    { ok: true, data: { sitrep, night, anomalies } },
    { headers: { "cache-control": "no-store" } },
  );
}
