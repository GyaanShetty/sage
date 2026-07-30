import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Past briefings, newest first.
 *
 * The debrief generator already writes every script it produces as a
 * `debrief.generated` event, but nothing ever read them back — a briefing you
 * missed was gone. This exposes them so any of the last fortnight can be
 * re-read or replayed on demand.
 */
export async function GET(req: Request) {
  const limit = Math.min(30, Number(new URL(req.url).searchParams.get("limit") ?? 14) || 14);

  const { data, error } = await db
    .from("Event")
    .select("id, createdAt, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "debrief.generated")
    .order("createdAt", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const items = (data ?? [])
    .map((row) => {
      const p = row.payload as { bucket?: string; text?: string } | null;
      return p?.text
        ? { id: row.id, createdAt: row.createdAt, bucket: p.bucket ?? null, text: p.text }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ ok: true, data: items });
}
