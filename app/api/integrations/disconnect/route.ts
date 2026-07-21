import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/** Disconnect an integration (deletes stored tokens). */
export async function POST(req: Request) {
  const { provider } = (await req.json()) as { provider?: string };
  if (!provider) return NextResponse.json({ ok: false, error: "provider required" }, { status: 400 });
  const { error } = await db
    .from("Integration")
    .delete()
    .eq("userId", DEFAULT_USER_ID)
    .eq("provider", provider);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
