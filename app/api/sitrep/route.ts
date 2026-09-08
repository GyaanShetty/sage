import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { getWeather } from "@/infrastructure/weather";
import { getMarkets } from "@/infrastructure/markets";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";
import { fmt, tzHour } from "@/lib/config";
import { listExams, nextExam, countdownFor, inExamMode } from "@/core/exam";
import { readSitrep } from "@/core/sitrep/read";

/**
 * No cache, and no revalidate window.
 *
 * This used to be cached for five minutes, which for a strip whose whole
 * purpose is "what needs attention right now" meant it could tell you an event
 * was in ninety minutes when it had already started. A stale status board is
 * worse than none, because you act on it.
 */
export const dynamic = "force-dynamic";

export interface Alert { level: "info" | "warn" | "high"; icon: string; text: string }

/** Proactive situation report — SAGE notices things instead of waiting. */
export async function GET() {
  const alerts: Alert[] = [];
  const now = Date.now();

  const [{ data: tasks }, events, weather, coins, { data: health }, { data: reminder }, { data: apps }, exams] = await Promise.all([
    db.from("Task").select("title, dueAt, status, createdAt, priority").eq("userId", DEFAULT_USER_ID).neq("status", "done").neq("status", "cancelled").limit(50),
    listUpcomingEvents(8).catch(() => null),
    getWeather().catch(() => null),
    getMarkets().catch(() => null),
    db.from("Event").select("payload").eq("userId", DEFAULT_USER_ID).eq("type", "health.report").gte("createdAt", new Date(now - 36 * 3600e3).toISOString()).order("createdAt", { ascending: false }).limit(1).maybeSingle(),
    // Three more things the board could already have known and did not. All
    // are indexed reads against data SAGE holds — nothing here reaches out to
    // a network, because this route is polled.
    db.from("Reminder").select("text, remindAt").eq("userId", DEFAULT_USER_ID).eq("status", "pending").gt("remindAt", new Date(now).toISOString()).order("remindAt", { ascending: true }).limit(1).maybeSingle(),
    db.from("Event").select("payload").eq("userId", DEFAULT_USER_ID).eq("type", "career.application").limit(100),
    listExams().catch(() => []),
  ]);

  // Overdue & stale tasks
  const overdue = (tasks ?? []).filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now);
  if (overdue.length) alerts.push({ level: "high", icon: "⚑", text: `${overdue.length} task${overdue.length > 1 ? "s" : ""} overdue — top: "${overdue[0].title}"` });
  const stale = (tasks ?? []).filter((t) => t.priority <= 1 && t.createdAt && now - new Date(t.createdAt).getTime() > 5 * 864e5 && !t.dueAt);
  if (stale.length) alerts.push({ level: "warn", icon: "⧗", text: `"${stale[0].title}" has sat ${Math.round((now - new Date(stale[0].createdAt as string).getTime()) / 864e5)} days — kill it or do it?` });

  // Calendar: next event soon, or a free afternoon
  const soon = (events ?? []).find((e) => { const t = new Date(e.start).getTime(); return t > now && t - now < 90 * 60e3 && !e.allDay; });
  if (soon) alerts.push({ level: "warn", icon: "◷", text: `"${soon.summary}" in ${Math.round((new Date(soon.start).getTime() - now) / 60e3)} min` });

  // AQI / weather
  if (weather?.aqi != null && weather.aqi >= 150) alerts.push({ level: "high", icon: "☁", text: `AQI ${weather.aqi} in ${weather.place} — unhealthy, skip the outdoor run` });
  else if (weather && /rain|drizzle|shower|thunder/i.test(weather.label) && tzHour() >= 6 && tzHour() <= 20) alerts.push({ level: "info", icon: "☂", text: `${weather.label} in ${weather.place} — carry an umbrella` });

  // Markets: big move
  for (const c of coins ?? []) {
    if (Math.abs(c.change24h) >= 6) { alerts.push({ level: "warn", icon: c.change24h > 0 ? "▲" : "▽", text: `${c.symbol} ${c.change24h > 0 ? "up" : "down"} ${Math.abs(c.change24h).toFixed(1)}% in 24h` }); break; }
  }

  // Health nudge
  const steps = Number((health?.payload as { steps?: number } | null)?.steps ?? NaN);
  if (!Number.isNaN(steps) && steps < 2000 && tzHour() >= 18) alerts.push({ level: "info", icon: "◈", text: `Only ${Math.round(steps).toLocaleString("en-IN")} steps today — a short walk?` });

  // A reminder inside the hour, which is the window in which knowing changes
  // what you do next.
  if (reminder) {
    const mins = Math.round((new Date(reminder.remindAt as string).getTime() - now) / 60e3);
    if (mins >= 0 && mins <= 60) alerts.push({ level: "warn", icon: "⏰", text: `"${reminder.text}" in ${mins} min` });
  }

  // The soonest application deadline still ahead. These are quoted from mail,
  // never generated — see core/career/inbox.ts.
  const deadlines = (apps ?? [])
    .map((r) => (r.payload ?? {}) as { company?: string; deadline?: string | null })
    .filter((a): a is { company: string; deadline: string } => !!a.deadline && !!a.company && new Date(a.deadline).getTime() > now)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (deadlines.length) {
    const days = Math.ceil((new Date(deadlines[0].deadline).getTime() - now) / 864e5);
    if (days <= 7) alerts.push({ level: days <= 2 ? "high" : "warn", icon: "⚑", text: `${deadlines[0].company} closes in ${days} day${days === 1 ? "" : "s"}` });
  }

  // The exam, while one is close enough to be driving the week.
  const soonestExam = nextExam(exams);
  if (soonestExam && inExamMode(exams)) {
    const c = countdownFor(soonestExam);
    alerts.push({ level: c.days <= 3 ? "high" : "info", icon: "◵", text: `${c.days} day${c.days === 1 ? "" : "s"} to ${c.exam.subject}` });
  }

  if (!alerts.length) alerts.push({ level: "info", icon: "✓", text: `All quiet. ${(tasks ?? []).length} open task${(tasks ?? []).length === 1 ? "" : "s"}, nothing pressing.` });

  // rank: high → warn → info
  const order = { high: 0, warn: 1, info: 2 } as const;
  alerts.sort((a, b) => order[a.level] - order[b.level]);
  const top = alerts.slice(0, 6);

  /**
   * The read: what a chief of staff would say about the board.
   *
   * Every fact in `top` came from the rules above. The model gets those lines
   * and nothing else, and is forbidden to add to them — so the worst it can do
   * is phrase the ranking badly, never state a deadline that does not exist.
   * It is cached on the content of the board, so polling a board that has not
   * changed costs nothing, and it is null rather than blocking when there is
   * no model or the call is slow.
   */
  const read = await readSitrep(top);

  return NextResponse.json(
    { ok: true, data: top, read, at: fmt(new Date(), { hour: "2-digit", minute: "2-digit", hour12: false }) },
    { headers: { "cache-control": "no-store" } },
  );
}
