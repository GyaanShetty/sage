import type { Metadata } from "next";
import {
  CommandView,
  type EventRow,
  type LogRow,
  type NoteRow,
  type Stats,
  type TaskRow,
} from "@/features/dashboard/components/command-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";

export const metadata: Metadata = { title: "Command" };
export const dynamic = "force-dynamic";

async function count(table: string): Promise<number> {
  const { count: n } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("userId", DEFAULT_USER_ID);
  return n ?? 0;
}

export default async function DashboardPage() {
  const [{ data: tasks }, events, { data: notes }, { data: log }, memories, sources, runs, noteCount] =
    await Promise.all([
      db
        .from("Task")
        .select("id, title, status, dueAt")
        .eq("userId", DEFAULT_USER_ID)
        .neq("status", "cancelled")
        .order("priority", { ascending: true })
        .order("createdAt", { ascending: false })
        .limit(6),
      listUpcomingEvents(8).catch(() => null) as Promise<EventRow[] | null>,
      db
        .from("Note")
        .select("id, title, createdAt")
        .eq("userId", DEFAULT_USER_ID)
        .eq("kind", "doc")
        .order("createdAt", { ascending: false })
        .limit(6),
      db
        .from("Event")
        .select("type, createdAt")
        .eq("userId", DEFAULT_USER_ID)
        .order("createdAt", { ascending: false })
        .limit(8),
      count("Memory"),
      count("Source"),
      count("AgentRun"),
      count("Note"),
    ]);

  const stats: Stats = { memories, sources, runs, notes: noteCount };
  return (
    <CommandView
      tasks={(tasks ?? []) as TaskRow[]}
      events={events}
      notes={(notes ?? []) as NoteRow[]}
      log={(log ?? []) as LogRow[]}
      stats={stats}
      userName="Gyaan"
    />
  );
}
