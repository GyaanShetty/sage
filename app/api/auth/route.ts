import { NextResponse } from "next/server";
import {
  SESSION_COOKIE, COOKIE_OPTIONS, SESSION_MAX_AGE_SECONDS,
  issueToken, timingSafeEqual,
} from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Login attempt throttling.
 *
 * A single unauthenticated endpoint guarding the whole system, with no limit,
 * is an invitation to guess at it. This is per-instance memory rather than a
 * shared store — on serverless that means an attacker spread across enough cold
 * starts sees a weaker limit than the numbers suggest. It is still worth having:
 * it defeats the naive case completely, and the alternative is nothing at all.
 */
const attempts = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60_000;
const FREE_ATTEMPTS = 5;

function clientKey(req: Request): string {
  // Vercel sets both; the first hop of x-forwarded-for is the real client.
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "unknown";
}

function penalty(n: number): number {
  // 1s, 4s, 9s, … capped at five minutes. Slow enough that guessing is
  // pointless, short enough that a genuine fat-finger is barely noticed.
  const over = Math.max(0, n - FREE_ATTEMPTS);
  return Math.min(300_000, over * over * 1000);
}

export async function POST(req: Request) {
  const password = process.env.SAGE_PASSWORD;
  if (!password) return NextResponse.json({ ok: true }); // gate disabled (local dev)

  const key = clientKey(req);
  const now = Date.now();
  const record = attempts.get(key);
  if (record && record.until > now) {
    // Count the blocked attempt too. Returning early without incrementing
    // pinned the penalty at its current value, so hammering the endpoint once
    // per second never escalated past one second — the limit looked like a
    // limit and wasn't one.
    const count = record.count + 1;
    const until = Math.max(record.until, now + penalty(count));
    attempts.set(key, { count, until });
    const seconds = Math.ceil((until - now) / 1000);
    return NextResponse.json(
      { ok: false, error: `Too many attempts. Try again in ${seconds}s.` },
      { status: 429, headers: { "retry-after": String(seconds) } },
    );
  }
  // Window elapsed → start fresh rather than carrying old failures forever.
  if (record && now - record.until > WINDOW_MS) attempts.delete(key);

  const { password: attempt } = await req.json().catch(() => ({ password: "" }));
  if (typeof attempt !== "string" || !timingSafeEqual(attempt, password)) {
    const count = (attempts.get(key)?.count ?? 0) + 1;
    attempts.set(key, { count, until: now + penalty(count) });
    return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }

  attempts.delete(key); // a success clears that client's slate
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await issueToken(password), {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
