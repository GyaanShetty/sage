import { NextResponse } from "next/server";
import { consolidateMemories } from "@/core/memory/consolidate";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** What the last sweep did — so the page can show it without re-running one. */
export async function GET() {
  const { data } = await db
    .from("Event")
    .select("createdAt, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "memory.consolidated")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    data: data ? { at: data.createdAt, ...(data.payload as object) } : null,
  });
}

/** Run a sweep now. Idempotent — safe to press twice. */
export async function POST() {
  try {
    return NextResponse.json({ ok: true, data: await consolidateMemories() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Consolidation failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
