import { NextResponse } from "next/server";
import { SESSION_COOKIE, COOKIE_OPTIONS } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Sign out. POST only — a GET would let any page on the internet sign you out
 * with an <img> tag, and SameSite=Lax still permits top-level GET navigations.
 *
 * Clears by setting the cookie empty with maxAge 0 and the exact same flags it
 * was written with; a mismatched path or domain leaves the original in place.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
