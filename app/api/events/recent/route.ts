import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/** Recent system events — feeds the toast/notification layer. */
export async function GET() {
  const { data } = await db
    .from("Event")
    .select("id, type, payload, createdAt")
    .eq("userId", DEFAULT_USER_ID)
    .order("createdAt", { ascending: false })
    .limit(12);
  return NextResponse.json({ ok: true, data: data ?? [] });
}
