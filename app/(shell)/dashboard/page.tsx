import type { Metadata } from "next";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import {
  listUnreadEmails,
  listUpcomingEvents,
  type CalendarEvent,
  type EmailSummary,
} from "@/infrastructure/integrations/google";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

async function count(table: string): Promise<number> {
  const { count: n } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("userId", DEFAULT_USER_ID);
  return n ?? 0;
}

export default async function DashboardPage() {
  const [{ data: tasks }, { data: reminders }, events, emails, memoryCount, sourceCount, runCount, { data: log }] =
    await Promise.all([
      db
        .from("Task")
        .select("id, title, status, dueAt")
        .eq("userId", DEFAULT_USER_ID)
        .in("status", ["todo", "doing"])
        .order("priority", { ascending: true })
        .order("dueAt", { ascending: true, nullsFirst: false })
        .limit(6),
      db
        .from("Reminder")
        .select("id, text, remindAt")
        .eq("userId", DEFAULT_USER_ID)
        .eq("status", "pending")
        .order("remindAt", { ascending: true })
        .limit(4),
      listUpcomingEvents(8).catch(() => null) as Promise<CalendarEvent[] | null>,
      listUnreadEmails(3).catch(() => null) as Promise<EmailSummary[] | null>,
      count("Memory"),
      count("Source"),
      count("AgentRun"),
      db
        .from("Event")
        .select("type, createdAt")
        .eq("userId", DEFAULT_USER_ID)
        .order("createdAt", { ascending: false })
        .limit(7),
    ]);

  return (
    <DashboardView
      tasks={tasks ?? []}
      reminders={reminders ?? []}
      events={events}
      emails={emails}
      stats={{ memories: memoryCount, sources: sourceCount, runs: runCount }}
      log={log ?? []}
    />
  );
}
