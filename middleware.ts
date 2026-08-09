import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth";
import { MUTATING, sameOrigin } from "@/lib/security";

/**
 * Access gate: when SAGE_PASSWORD is set, every page and API route requires
 * the session cookie. /login, /api/auth and /api/cron (own secret) stay open.
 */
export async function middleware(req: NextRequest) {
  const password = process.env.SAGE_PASSWORD;
  if (!password) return NextResponse.next(); // gate disabled (local dev)

  const { pathname } = req.nextUrl;

  /**
   * Machine endpoints, called by things that are not a browser.
   *
   * An external scheduler sends no Origin header and holds no cookie, so these
   * cannot be origin-checked and must not be. Each carries its own secret,
   * compared in constant time inside the route.
   */
  const machine =
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/beat") ||
    pathname.startsWith("/api/webhook");

  /**
   * Cross-site request forgery, second lock.
   *
   * SameSite=Lax already stops another site's POST from carrying the session
   * cookie, so this is defence in depth — but Lax is a browser policy, and a
   * policy is only as good as the browser honouring it. A state-changing
   * request has to say it came from here.
   *
   * Deliberately ahead of the public-path list. Sign-in and passkey enrolment
   * live under /api/auth, and those are precisely the requests worth
   * protecting from another site — checking after the allowlist would have
   * exempted them.
   */
  if (!machine && MUTATING.has(req.method) && !sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "CROSS_ORIGIN_REFUSED" }, { status: 403 });
  }

  // Public: login, auth, cron, and PWA install assets (manifest, SW, icons).
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/cron") ||
    // The heartbeat carries its own CRON_SECRET, checked in the route. It has
    // to be reachable by an external scheduler that has no session cookie —
    // that is the entire point of it.
    pathname.startsWith("/api/beat") ||
    pathname.startsWith("/api/webhook") ||
    // Which build is serving — public so "did my fix ship?" is answerable
    // without being logged in. Reports the commit only, never config.
    pathname === "/api/version" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/icon-") ||
    pathname.startsWith("/geo/")
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifyToken(cookie, password)) return NextResponse.next();

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
