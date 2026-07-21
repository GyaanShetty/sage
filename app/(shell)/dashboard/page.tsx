import type { Metadata } from "next";
import {
  CommandView,
  type EventRow,
  type LogRow,
  type NoteRow,
  type Stats,
  type TaskRow,
} from "@/features/dashboard/components/command-view";
import { ConsoleBand, ReviewBand, WorldBand } from "@/features/dashboard/components/bands";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";
import { getWeather } from "@/infrastructure/weather";

export const metadata: Metadata = { title: "Command" };
export const dynamic = "force-dynamic";

async function count(table: string): Promise<number> {
  const { count: n } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("userId", DEFAULT_USER_ID);
  return n ?? 0;
}

interface TiptapDoc {
  content?: { content?: { text?: string }[] }[];
}

export default async function DashboardPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

  const [
    { data: tasks },
    events,
    { data: notes },
    { data: log },
    memories,
    sources,
    runs,
    noteCount,
    { data: weekEvents },
    { data: journalNote },
    weather,
  ] = await Promise.all([
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
    db
      .from("Event")
      .select("createdAt")
      .eq("userId", DEFAULT_USER_ID)
      .gte("createdAt", weekAgo)
      .limit(1000),
    db
      .from("Note")
      .select("content")
      .eq("userId", DEFAULT_USER_ID)
      .eq("kind", "journal")
      .eq("journalDate", today.toISOString())
      .maybeSingle(),
    getWeather(),
  ]);

  // Mon..Sun real event counts
  const activity = [0, 0, 0, 0, 0, 0, 0];
  for (const row of weekEvents ?? []) {
    const idx = (new Date(row.createdAt as string).getDay() + 6) % 7;
    activity[idx] += 1;
  }

  const journal = (((journalNote?.content ?? {}) as TiptapDoc).content ?? [])
    .map((p) => p.content?.[0]?.text ?? "")
    .filter(Boolean)
    .slice(0, 6);

  const stats: Stats = { memories, sources, runs, notes: noteCount };
  const open = (tasks ?? []).filter((t) => t.status !== "done").length;

  return (
    <div>
      <CommandView
        tasks={(tasks ?? []) as TaskRow[]}
        events={events}
        notes={(notes ?? []) as NoteRow[]}
        log={(log ?? []) as LogRow[]}
        stats={stats}
        weather={weather}
        userName="Gyaan"
      />
      <WorldBand />
      <ConsoleBand stats={{ open, notes: noteCount, memories }} />
      <ReviewBand activity={activity} journal={journal} />
    </div>
  );
}
