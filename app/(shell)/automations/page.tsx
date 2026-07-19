import type { Metadata } from "next";
import {
  AutomationsView,
  type AutomationItem,
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
  // attach last report per automation
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
      a.lastReport = entry?.report ?? (entry?.error ? `FAILED: ${entry.error}` : null);
    }),
  );

  return <AutomationsView automations={automations} />;
}
