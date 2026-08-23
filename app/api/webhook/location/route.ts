import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { machineAuth } from "@/lib/security";

/** iPhone Shortcuts posts arrival/departure: { place: "Home"|"Gym"|..., event: "arrive"|"leave" } */
export async function POST(req: Request) {
  if (!machineAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let body: { place?: string; event?: string; lat?: number; lon?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }
  await ensureDefaultUser();
  await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "location.update", payload: body });
  return NextResponse.json({ ok: true });
}
