import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { sameOrigin } from "@/lib/security";

/**
 * The browser's own position, into the same store the phone writes to.
 *
 * Separate from /api/webhook/location because the trust model is different.
 * That route is for machines and takes a shared secret; this one is the app
 * talking to itself in a session that is already authenticated, so it takes
 * same-origin instead. Putting a machine secret in client JavaScript to reuse
 * one route would publish the secret to anyone who opens devtools.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "cross-origin" }, { status: 403 });
  }

  let body: { lat?: number; lon?: number; accuracy?: number; event?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 }); }

  const { lat, lon } = body;
  if (typeof lat !== "number" || typeof lon !== "number" ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: "coordinates out of range" }, { status: 400 });
  }

  await ensureDefaultUser();
  const { error } = await db.from("Event").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    type: "location.update",
    payload: { lat, lon, accuracy: body.accuracy, event: "browser" },
  });
  // Supabase returns errors rather than throwing them.
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
