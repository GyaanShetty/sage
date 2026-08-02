import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Error capture and triage.
 *
 * The ask was an app that rebuilds itself from its own errors. Capture and
 * diagnosis are the genuinely valuable parts of that, and they are what this
 * does. Applying the fix unattended is the part that is a bad idea: this
 * repository is public, deploys straight to production, and holds live data —
 * an automated patch loop at 3am has no reviewer and no way to tell a fix from
 * a plausible-looking regression. So SAGE proposes the diff and you approve it.
 *
 * Errors are grouped by fingerprint rather than stored one row per occurrence.
 * A loop that throws four hundred times is one problem, and a list that says so
 * four hundred times buries the other three.
 */

const TYPE = "ops.error";

export interface ErrorReport {
  fingerprint: string;
  message: string;
  stack?: string;
  /** Where it happened: a route, a component, a job name. */
  where: string;
  /** "client" | "server" | "cron" — the same message means different things. */
  side: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  resolvedAt?: string;
  /** Anything useful that is not secret: url, user agent, job id. */
  context?: Record<string, string>;
}

/**
 * Stable identity for an error.
 *
 * Numbers are stripped — ids, line offsets and timestamps differ per
 * occurrence and would otherwise make every instance its own "new" error,
 * which is the failure mode that makes error dashboards useless.
 */
export function fingerprint(message: string, where: string, side: string): string {
  const norm = message
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, "#")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `${side}|${where}|${norm}`;
}

/** Strip anything that should never be stored, however it arrived. */
function scrub(text: string): string {
  return text
    .replace(/(api[-_]?key|token|secret|password|authorization|bearer)["'\s:=]+[\w.\-]+/gi, "$1=***")
    .replace(/eyJ[\w.\-]{20,}/g, "***jwt***")
    .replace(/sk-[\w\-]{16,}/g, "***key***")
    .slice(0, 4000);
}

export async function recordError(input: {
  message: string;
  stack?: string;
  where: string;
  side: string;
  context?: Record<string, string>;
}): Promise<ErrorReport | null> {
  const message = scrub(input.message || "Unknown error");
  const where = (input.where || "unknown").slice(0, 200);
  const side = (input.side || "client").slice(0, 20);
  const fp = fingerprint(message, where, side);
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>fingerprint", fp)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const prev = existing.payload as ErrorReport;
    const next: ErrorReport = {
      ...prev,
      count: (prev.count ?? 1) + 1,
      lastSeen: now,
      // A recurrence un-resolves it. Marking something fixed does not make it
      // fixed, and hiding it after it came back is how a bug gets forgotten.
      resolvedAt: undefined,
      stack: prev.stack ?? (input.stack ? scrub(input.stack) : undefined),
    };
    await db.from("Event").update({ payload: next }).eq("id", existing.id);
    return next;
  }

  const report: ErrorReport = {
    fingerprint: fp,
    message,
    stack: input.stack ? scrub(input.stack) : undefined,
    where, side,
    count: 1,
    firstSeen: now,
    lastSeen: now,
    context: input.context,
  };
  await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE, payload: report,
  });
  return report;
}

export async function listErrors(includeResolved = false): Promise<ErrorReport[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(200);

  return (data ?? [])
    .map((r) => r.payload as ErrorReport)
    .filter((e) => e?.fingerprint && (includeResolved || !e.resolvedAt))
    // Loudest and most recent first — frequency alone would pin an old,
    // already-understood loop to the top forever.
    .sort((a, b) => (b.count - a.count) || b.lastSeen.localeCompare(a.lastSeen));
}

export async function resolveError(fp: string): Promise<boolean> {
  const { data } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>fingerprint", fp)
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  await db
    .from("Event")
    .update({ payload: { ...(data.payload as ErrorReport), resolvedAt: new Date().toISOString() } })
    .eq("id", data.id);
  return true;
}
