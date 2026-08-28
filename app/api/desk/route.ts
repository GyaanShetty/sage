import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";
import { startOfTodayUtc, endOfTodayUtc } from "@/lib/config";

/**
 * The numbers along the top of the screen.
 *
 * One endpoint rather than five, because the strip is a single glance and
 * five polls for one row of figures is exactly the kind of waste that spends
 * a free tier on nothing. Everything here is a count over data SAGE already
 * holds; nothing new is fetched from an upstream.
 *
 * `uplink` is the honest version of the reference's network readout: the time
 * this request itself took to gather its data. A made-up "41MS" would look
 * right and mean nothing, and once one readout on a screen is decorative the
 * others stop being believed.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const began = Date.now();
  const today = { from: startOfTodayUtc(), to: endOfTodayUtc() };

  const [tasks, events, runs, alerts, notes, memories] = await Promise.all([
    db.from("Task").select("id", { count: "exact", head: true })
      .eq("userId", DEFAULT_USER_ID).neq("status", "done").neq("status", "cancelled"),
    listUpcomingEvents(20).catch(() => null),
    db.from("Event").select("id", { count: "exact", head: true })
      .eq("userId", DEFAULT_USER_ID).eq("type", "agent.run").gte("createdAt", today.from),
    db.from("Event").select("id", { count: "exact", head: true })
      .eq("userId", DEFAULT_USER_ID).eq("type", "alert.raised").gte("createdAt", today.from),
    db.from("Note").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID),
    db.from("Memory").select("id", { count: "exact", head: true }).eq("userId", DEFAULT_USER_ID),
  ]);

  // Events today, and how much of the day they claim.
  const start = new Date(today.from).getTime(), end = new Date(today.to).getTime();
  const todays = (events ?? []).filter((e) => {
    const t = new Date(e.start).getTime();
    return t >= start && t <= end;
  });
  const committedMin = todays.reduce((sum, e) => {
    if (e.allDay || !e.end) return sum;
    return sum + Math.max(0, (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000);
  }, 0);

  return NextResponse.json({
    ok: true,
    data: {
      openTasks: tasks.count ?? 0,
      events: todays.length,
      committedMin: Math.round(committedMin),
      agentRuns: runs.count ?? 0,
      alerts: alerts.count ?? 0,
      notes: notes.count ?? 0,
      memories: memories.count ?? 0,
      uplinkMs: Date.now() - began,
    },
  });
}
