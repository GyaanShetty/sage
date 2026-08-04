import { NextResponse } from "next/server";
import { runDueAutomations } from "@/core/automation/run";
import { maybeSendWeeklyReview } from "@/core/review/weekly";
import { maybeSaveDailyDigest } from "@/core/review/daily";
import { runAnticipation } from "@/core/anticipate/engine";
import { runNotifications } from "@/core/notify/engine";
import { generateDailyCards } from "@/core/retention/cards";
import { maybeScanInbox } from "@/core/career/scan";
import { maybeConsolidateMemories } from "@/core/memory/consolidate";
import { maybeGenerateLifeReport } from "@/core/report/life";
import { syncHevy } from "@/core/health/hevy";
import { closeHealthDay } from "@/core/health/daily";
import { pruneEvents } from "@/core/ops/retention";
import { fireDueReminders } from "@/core/reminders/fire";

export const maxDuration = 300;

/**
 * Scheduler tick (wire to Vercel Cron / Supabase cron). Fires due reminders:
 * marks them and mirrors each into a high-priority task so it surfaces
 * everywhere until richer channels (push/email) land.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Shared with /api/reminders/tick, which the app polls while it is open —
  // the cron is the floor, not the only path. See core/reminders/fire.ts.
  const fired = await fireDueReminders().catch(() => []);

  const automationsRan = await runDueAutomations().catch(() => 0);
  const weeklyReviewSent = await maybeSendWeeklyReview().catch(() => false);
  const dailyDigestSaved = await maybeSaveDailyDigest().catch(() => false);
  const anticipated = await runAnticipation().catch(() => 0);
  const notifications = await runNotifications().catch(() => ({}));
  const cardsGenerated = await generateDailyCards().catch(() => 0);
  const careerScan = await maybeScanInbox().catch(() => ({ added: 0, updated: 0 }));
  // Once a day at most; the guard lives in the function, not the schedule.
  const memory = await maybeConsolidateMemories().catch(() => null);
  // Weekly, guarded on the last stored report rather than the clock, so a
  // missed week produces one at the next tick instead of waiting another seven.
  const lifeReport = (await maybeGenerateLifeReport().catch(() => null)) ? 1 : 0;
  // Cheap and idempotent — re-syncing updates rather than duplicating, so this
  // can run every tick without a guard.
  const hevy = await syncHevy().catch(() => ({ ok: false, added: 0, updated: 0 }));
  // Safety net: if the 9pm tick was missed (a deploy, an outage), this still
  // closes the day out — the function checks the hour and the day itself, so
  // running it here cannot double-nudge.
  const dayClosed = await closeHealthDay().catch(() => null);
  // Housekeeping: the Event table is a universal store and nothing ever
  // deleted from it. Retention is per-type and conservative — see
  // core/ops/retention.ts — so this only removes bookkeeping and regenerable
  // content, never the user's own records.
  const pruned = (await pruneEvents().catch(() => null))?.total ?? 0;

  return NextResponse.json({ ok: true, fired: fired.length, automationsRan, weeklyReviewSent, dailyDigestSaved, anticipated, notifications, cardsGenerated, careerScan, memory, lifeReport, hevy, dayClosed, pruned });
}
