import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { getWeather } from "@/infrastructure/weather";
import { getMarkets } from "@/infrastructure/markets";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";
import { fmt, tzHour } from "@/lib/config";

export const revalidate = 300;

export interface Alert { level: "info" | "warn" | "high"; icon: string; text: string }

/** Proactive situation report — SAGE notices things instead of waiting. */
export async function GET() {
  const alerts: Alert[] = [];
  const now = Date.now();

  const [{ data: tasks }, events, weather, coins, { data: health }] = await Promise.all([
    db.from("Task").select("title, dueAt, status, createdAt, priority").eq("userId", DEFAULT_USER_ID).neq("status", "done").neq("status", "cancelled").limit(50),
    listUpcomingEvents(8).catch(() => null),
    getWeather().catch(() => null),
    getMarkets().catch(() => null),
    db.from("Event").select("payload").eq("userId", DEFAULT_USER_ID).eq("type", "health.report").gte("createdAt", new Date(now - 36 * 3600e3).toISOString()).order("createdAt", { ascending: false }).limit(1).maybeSingle(),
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

  if (!alerts.length) alerts.push({ level: "info", icon: "✓", text: `All quiet. ${(tasks ?? []).length} open task${(tasks ?? []).length === 1 ? "" : "s"}, nothing pressing.` });

  // rank: high → warn → info
  const order = { high: 0, warn: 1, info: 2 } as const;
  alerts.sort((a, b) => order[a.level] - order[b.level]);
  return NextResponse.json({ ok: true, data: alerts.slice(0, 6), at: fmt(new Date(), { hour: "2-digit", minute: "2-digit", hour12: false }) });
}
