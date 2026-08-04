import { NextResponse } from "next/server";
import { trainingProgress } from "@/core/health/progression";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const days = Math.min(365, Math.max(28, Number(new URL(req.url).searchParams.get("days")) || 120));
  return NextResponse.json({ ok: true, data: await trainingProgress(days) });
}
