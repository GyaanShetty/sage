import { NextResponse } from "next/server";
import { drift } from "@/core/memory/drift";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** How his attention has moved, month by month. Arithmetic, not a model. */
export async function GET() {
  return NextResponse.json({ ok: true, data: await drift() });
}
