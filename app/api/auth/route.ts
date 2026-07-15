import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken, timingSafeEqual } from "@/lib/auth";

export async function POST(req: Request) {
  const password = process.env.SAGE_PASSWORD;
  if (!password) return NextResponse.json({ ok: true }); // gate disabled

  const { password: attempt } = await req.json().catch(() => ({ password: "" }));
  if (typeof attempt !== "string" || !timingSafeEqual(attempt, password)) {
    return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
