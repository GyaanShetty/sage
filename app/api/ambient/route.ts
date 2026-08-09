import { NextResponse } from "next/server";
import { gatherAmbient } from "@/core/ambient";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Everything worth mentioning, ranked. The client decides what to say. */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: { items: await gatherAmbient() } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 160) }, { status: 500 });
  }
}
