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

export default async function DashboardPage() {
  const [{ data: tasks }, { data: reminders }, events, emails] = await Promise.all([
    db
      .from("Task")
      .select("id, title, status, dueAt")
      .eq("userId", DEFAULT_USER_ID)
      .in("status", ["todo", "doing"])
      .order("priority", { ascending: true })
      .order("dueAt", { ascending: true, nullsFirst: false })
      .limit(5),
    db
      .from("Reminder")
      .select("id, text, remindAt")
      .eq("userId", DEFAULT_USER_ID)
      .eq("status", "pending")
      .order("remindAt", { ascending: true })
      .limit(5),
    listUpcomingEvents(3).catch(() => null) as Promise<CalendarEvent[] | null>,
    listUnreadEmails(3).catch(() => null) as Promise<EmailSummary[] | null>,
  ]);
  return (
    <DashboardView
      tasks={tasks ?? []}
      reminders={reminders ?? []}
      events={events}
      emails={emails}
    />
  );
}
