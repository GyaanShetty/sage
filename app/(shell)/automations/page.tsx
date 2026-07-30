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
  await Promise.all(
    automations.map(async (a) => {
      const { data: run } = await db
        .from("AutomationRun")
        .select("log, status")
        .eq("automationId", a.id)
        .order("startedAt", { ascending: false })
        .limit(1)
        .maybeSingle();
      const entry = (run?.log as { report?: string; error?: string }[] | null)?.[0];
      a.lastStatus = (run?.status as AutomationItem["lastStatus"]) ?? null;
      a.lastReport = entry?.report ?? (entry?.error ? `FAILED: ${entry.error}` : null);
    }),
  );

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
