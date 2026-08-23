import { NextResponse } from "next/server";
import { beat, type Job } from "@/core/ops/heartbeat";
import { fireDueReminders } from "@/core/reminders/fire";
import { syncEventReminders } from "@/core/reminders/prep";
import { runDueAutomations } from "@/core/automation/run";
import { evaluateAlerts } from "@/core/portfolio/alerts";
import { runNotifications } from "@/core/notify/engine";
import { runBackup, lastBackup } from "@/core/ops/backup";
import { syncHevy } from "@/core/health/hevy";
import { runNightShift } from "@/core/night/shift";
import { machineAuth } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The heartbeat endpoint.
 *
 * Safe and cheap to call every minute: on a quiet minute it is one indexed
 * read of the last-run map plus one indexed read for due reminders, and
 * nothing else. The caller — a Cloudflare Worker cron, a free cron service —
 * knows no schedule at all. It knocks; this decides.
 *
 * Cadences are chosen against what the work costs. Reminders are pure database
 * and run every minute, because a reminder delivered five minutes late is not
 * a reminder. Anything that spends model quota or a rate-limited third-party
 * API is deliberately slower.
 */
const JOBS: Job[] = [
  {
    // The whole reason this exists. Twice-daily crons made a 3pm reminder
    // arrive at 9pm, as a note about something already missed.
    name: "reminders",
    everyMin: 1,
    run: async () => ({ fired: (await fireDueReminders()).length }),
  },
  {
    // Prep nudges for anything newly in the calendar. Quarter-hourly is
    // plenty: the nudge itself is 15 minutes ahead of the event.
    name: "prep",
    everyMin: 15,
    run: () => syncEventReminders(),
  },
  {
    // Price alerts, which until now were stored and never once evaluated.
    // Market hours only — a quote does not move at 3am, so checking then
    // spends a rate-limited API on nothing.
    name: "alerts",
    everyMin: 10,
    marketHours: true,
    run: () => evaluateAlerts(),
  },
  {
    // User-scheduled automations. Their own due-time check is inside; this
    // just gives them a chance to notice more than twice a day.
    name: "automations",
    everyMin: 5,
    run: async () => ({ ran: await runDueAutomations() }),
  },
  {
    // Costs model quota, so hourly and only while he is plausibly awake.
    name: "notifications",
    everyMin: 60,
    hours: [6, 23],
    run: () => runNotifications(),
  },
  {
    // Cheap, idempotent, and catches a session logged during the day.
    name: "hevy",
    everyMin: 180,
    hours: [6, 23],
    run: () => syncHevy(),
  },
  {
    // The night shift — the thing the heartbeat was really for. Once a night,
    // early enough to be finished before he wakes, late enough that anything
    // logged in the evening is already in.
    name: "night-shift",
    everyMin: 60 * 20,
    hours: [3, 6],
    run: () => runNightShift(),
  },
  {
    // Daily rather than weekly now that there is something to run it. The
    // evening cron keeps its own weekly backup as the floor for when the
    // heartbeat is not configured or has stopped.
    name: "backup",
    everyMin: 60 * 20,
    hours: [3, 5],
    run: async () => {
      const prev = await lastBackup().catch(() => null);
      if (prev && prev.ageDays < 1) return { skipped: true };
      return runBackup();
    },
  },
];

/**
 * Authorisation.
 *
 * The endpoint does real work and sends notifications, so it is not open. It
 * accepts the same CRON_SECRET the Vercel crons use, by header or query — a
 * query parameter because some free schedulers cannot set headers, and a
 * secret in a URL that only he and the scheduler hold is the lesser evil
 * against not being able to schedule at all.
 */
export async function GET(req: Request) {
  if (!machineAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const result = await beat(JOBS);
  return NextResponse.json({ ok: true, data: result });
}

/** POST behaves identically — some schedulers only send POST. */
export const POST = GET;
