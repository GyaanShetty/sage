import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LogEntry { at?: string; report?: string; error?: string; artifacts?: { kind: string; id?: string; label: string; href: string }[] }

/**
 * Run history for one automation.
 *
 * Every run has always been written to AutomationRun, but only the single
 * latest one was ever read back — so a directive that had been failing every
 * night for a week looked identical to one that had never run at all. This
 * returns the trail.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Ownership is enforced through the parent automation: AutomationRun has no
  // userId of its own, so querying it directly by id would leak across users.
  const { data: owner } = await db
    .from("Automation")
    .select("id")
    .eq("id", id)
    .eq("userId", DEFAULT_USER_ID)
    .maybeSingle();
  if (!owner) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const { data, error } = await db
    .from("AutomationRun")
    .select("id, status, startedAt, endedAt, log")
    .eq("automationId", id)
    .order("startedAt", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const runs = (data ?? []).map((r) => {
    const entry = (r.log as LogEntry[] | null)?.[0];
    return {
      id: r.id,
      status: r.status as "running" | "done" | "failed",
      startedAt: r.startedAt as string,
      endedAt: (r.endedAt as string | null) ?? null,
      report: entry?.report ?? null,
      artifacts: entry?.artifacts ?? [],
      error: entry?.error ?? null,
    };
  });

  return NextResponse.json({ ok: true, data: runs });
}
