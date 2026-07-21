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
import { LearnBand } from "@/features/dashboard/components/learn-band";
import { MissionControl } from "@/features/dashboard/components/mission-control";
import { OpsBand } from "@/features/dashboard/components/ops-band";
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
    { data: healthEvents },
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
    db
      .from("Event")
      .select("payload")
      .eq("userId", DEFAULT_USER_ID)
      .eq("type", "health.report")
      .gte("createdAt", new Date(Date.now() - 36 * 3600 * 1000).toISOString())
      .order("createdAt", { ascending: false })
      .limit(10),
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

  // Shortcuts may post each metric as its own request — merge recent reports,
  // newest value wins per key.
  let health: Record<string, unknown> | null = null;
  for (const ev of (healthEvents ?? []).reverse()) {
    const p = ev.payload as Record<string, unknown> | null;
    if (p && typeof p === "object") health = { ...(health ?? {}), ...p };
  }

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
      <MissionControl />
      <OpsBand />
      <WorldBand
        geo={{
          lat: Number(process.env.SAGE_LAT ?? 12.9716),
          lon: Number(process.env.SAGE_LON ?? 77.5946),
        }}
      />
      <ConsoleBand stats={{ open, notes: noteCount, memories }} />
      <ReviewBand
        activity={activity}
        journal={journal}
        health={health}
      />
      <LearnBand />
    </div>
  );
}
