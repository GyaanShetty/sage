import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionToken, timingSafeEqual } from "@/lib/auth";

/**
 * Access gate: when SAGE_PASSWORD is set, every page and API route requires
 * the session cookie. /login, /api/auth and /api/cron (own secret) stay open.
 */
export async function middleware(req: NextRequest) {
  const password = process.env.SAGE_PASSWORD;
  if (!password) return NextResponse.next(); // gate disabled (local dev)

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth") || pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const expected = await sessionToken(password);
  if (cookie && timingSafeEqual(cookie, expected)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
