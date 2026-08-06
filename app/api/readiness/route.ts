import { NextResponse } from "next/server";
import { readiness } from "@/core/health/readiness";

export const dynamic = "force-dynamic";

/** Training load against what he has adapted to, plus sleep. No model. */
export async function GET() {
  return NextResponse.json({ ok: true, data: await readiness() });
}
