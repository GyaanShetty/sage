import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which build is actually serving this request.
 *
 * Deliberately public (see middleware): the whole point is to be answerable
 * when you are locked out or looking from another machine. "Is my fix live?"
 * was otherwise unanswerable without the Vercel dashboard, which turned a
 * one-second check into guesswork.
 *
 * Only ever reports the commit — a public repo's SHA is not a secret — plus
 * the environment and region. No keys, no config values.
 */
export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
  return NextResponse.json({
    ok: true,
    data: {
      sha,
      short: sha.slice(0, 7),
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
      message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null,
      env: process.env.VERCEL_ENV ?? "development",
      region: process.env.VERCEL_REGION ?? null,
      now: new Date().toISOString(),
    },
  });
}
