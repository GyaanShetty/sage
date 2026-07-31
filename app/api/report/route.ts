import { NextResponse } from "next/server";
import { generateLifeReport, listLifeReports } from "@/core/report/life";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Stored reports, newest first. */
export async function GET() {
  const reports = await listLifeReports(12);
  return NextResponse.json({ ok: true, data: reports });
}

/** Generate one now over an arbitrary window. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { days?: number };
  // Clamped: a 400-day report would sweep in every row the queries touch and
  // tell you nothing useful about now.
  const days = Math.min(90, Math.max(1, Math.round(body.days ?? 7)));
  try {
    return NextResponse.json({ ok: true, data: await generateLifeReport(days) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Report failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
