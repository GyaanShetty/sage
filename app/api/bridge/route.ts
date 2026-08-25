import { NextResponse } from "next/server";
import { completeJob, pendingJobs } from "@/core/bridge";
import { machineAuth } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * The daemon's only door.
 *
 * GET  — what work is waiting.
 * POST — here is the answer to one job.
 *
 * ── Its own secret ────────────────────────────────────────────────────────
 *
 * BRIDGE_SECRET, not CRON_SECRET. They are different capabilities: the cron
 * secret runs scheduled jobs, this one reaches your filesystem. Sharing a
 * secret between them would mean rotating either one costs you both, and a
 * leak of the weaker one hands over the stronger.
 *
 * With BRIDGE_SECRET unset this route is shut, which is the right default —
 * an unset secret must never mean an open door to somebody's disk.
 */
function authed(req: Request): boolean {
  const secret = process.env.BRIDGE_SECRET;
  if (!secret) return false;
  return machineAuth(req, secret);
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const jobs = await pendingJobs().catch(() => []);
  return NextResponse.json({ ok: true, jobs });
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { id?: string; result?: unknown; error?: string }
    | null;
  if (!body?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const ok = await completeJob(body.id, {
    ...(body.error ? { error: String(body.error).slice(0, 400) } : { result: body.result }),
  });
  return NextResponse.json({ ok });
}
