import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * The local disk bridge.
 *
 * ── Direction ─────────────────────────────────────────────────────────────
 *
 * SAGE runs on Vercel and your Mac sits behind NAT, so SAGE cannot reach it —
 * and making it reachable would mean opening a port to the internet, which is
 * the thing nobody should do to their laptop. So the flow is inverted: SAGE
 * writes a job here, the daemon on the Mac asks for work over plain outbound
 * HTTPS, does it, and posts the answer back. Nothing listens on your network.
 *
 * ── What it can do ────────────────────────────────────────────────────────
 *
 * Read only. List a directory, read a text file, stat a path, search names.
 * No writes, no deletes, no shell. That is a deliberate ceiling rather than a
 * first milestone: a public web app that can execute on your machine is a
 * different risk category from one that can read some of your notes, and the
 * useful half — SAGE knowing what is in your files — needs only the reading.
 *
 * The allowlist lives on the Mac, not here. SAGE asks for a path; the daemon
 * decides whether that path is allowed. A compromised SAGE therefore cannot
 * widen its own access, because the thing enforcing the boundary is the thing
 * SAGE cannot reach.
 */

const TYPE = "bridge.job";

export type BridgeOp = "list" | "read" | "stat" | "search";

export interface BridgeJob {
  id: string;
  op: BridgeOp;
  path: string;
  /** For `search`: the substring to match against file names. */
  query?: string;
  status: "pending" | "done" | "error";
  result?: unknown;
  error?: string;
  at: string;
}

/** How long a caller waits for the Mac before giving up. */
const WAIT_MS = 12_000;
const POLL_MS = 400;

/** Queue a job and wait for the daemon to answer it. */
export async function ask(op: BridgeOp, path: string, query?: string): Promise<
  { ok: true; result: unknown } | { ok: false; error: string }
> {
  const id = crypto.randomUUID();
  const { error } = await db.from("Event").insert({
    id,
    userId: DEFAULT_USER_ID,
    type: TYPE,
    payload: { id, op, path, ...(query ? { query } : {}), status: "pending", at: new Date().toISOString() },
  });
  if (error) return { ok: false, error: error.message };

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const { data } = await db.from("Event").select("payload").eq("id", id).maybeSingle();
    const job = data?.payload as BridgeJob | undefined;
    if (!job || job.status === "pending") continue;
    if (job.status === "error") return { ok: false, error: job.error ?? "the daemon refused" };
    return { ok: true, result: job.result };
  }

  // Distinguish "your Mac is asleep" from "that path does not exist", because
  // the fixes are completely different and the symptom is the same silence.
  return {
    ok: false,
    error: "No answer from your machine. The bridge daemon may not be running — start it with `npm start` in ops/disk-bridge.",
  };
}

/** Jobs the daemon has not yet done. Called by the daemon, not the app. */
export async function pendingJobs(limit = 5): Promise<BridgeJob[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>status", "pending")
    .order("createdAt", { ascending: true })
    .limit(limit);
  return (data ?? []).map((r) => r.payload as BridgeJob);
}

/** The daemon reporting back. */
export async function completeJob(
  id: string,
  outcome: { result?: unknown; error?: string },
): Promise<boolean> {
  const { data } = await db.from("Event").select("payload").eq("id", id).maybeSingle();
  const job = data?.payload as BridgeJob | undefined;
  if (!job) return false;
  // Already answered: ignore rather than overwrite, so a daemon that retries
  // after a flaky network cannot clobber a result already handed to a caller.
  if (job.status !== "pending") return true;

  const { error } = await db
    .from("Event")
    .update({
      payload: {
        ...job,
        status: outcome.error ? "error" : "done",
        ...(outcome.error ? { error: outcome.error } : { result: outcome.result }),
      },
    })
    .eq("id", id);
  return !error;
}
