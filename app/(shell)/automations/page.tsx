import type { Metadata } from "next";
import {
  AutomationsView,
  type AutomationItem,
  type FleetHealth,
} from "@/features/automations/components/automations-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const metadata: Metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const { data } = await db
    .from("Automation")
    .select("id, name, trigger, workflow, enabled, lastRunAt")
    .eq("userId", DEFAULT_USER_ID)
    .order("createdAt", { ascending: false })
    .limit(50);

  const automations = (data ?? []) as AutomationItem[];

  // Attach the outcome of the most recent run, not just its text. A directive
  // that has been failing every night looked exactly like one that had never
  // run, because only the report string was read and a failure has none.
  //
  // Fetched in ONE query for every automation rather than one query each: the
  // old version was a textbook N+1, and with fifty directives that is fifty
  // sequential round trips to build a page that needs one.
  const automationIds = automations.map((a) => a.id);
  if (automationIds.length) {
    const { data: runs } = await db
      .from("AutomationRun")
      .select("automationId, log, status, startedAt")
      .in("automationId", automationIds)
      .order("startedAt", { ascending: false })
      .limit(automationIds.length * 5);

    // Newest first, so the first row seen for an id is its latest run.
    type RunRow = NonNullable<typeof runs>[number];
    const latest = new Map<string, RunRow>();
    for (const r of runs ?? []) {
      const id = r.automationId as string;
      if (!latest.has(id)) latest.set(id, r);
    }

    for (const a of automations) {
      const run = latest.get(a.id);
      const entry = (run?.log as { report?: string; error?: string; artifacts?: AutomationItem["lastArtifacts"] }[] | null)?.[0];
      a.lastStatus = (run?.status as AutomationItem["lastStatus"]) ?? null;
      a.lastReport = entry?.report ?? (entry?.error ? `FAILED: ${entry.error}` : null);
      a.lastArtifacts = entry?.artifacts ?? [];
    }
  }

  // Fleet health over the last day, so a quiet failure is visible at a glance
  // rather than only after opening the automation that broke.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const ids = automations.map((a) => a.id);
  let recent: { status: string }[] = [];
  if (ids.length) {
    const { data: runs } = await db
      .from("AutomationRun")
      .select("status")
      .in("automationId", ids)
      .gte("startedAt", since);
    recent = runs ?? [];
  }

  const health: FleetHealth = {
    total: automations.length,
    enabled: automations.filter((a) => a.enabled).length,
    runs24h: recent.length,
    failed24h: recent.filter((r) => r.status === "failed").length,
  };

  return <AutomationsView automations={automations} health={health} />;
}
