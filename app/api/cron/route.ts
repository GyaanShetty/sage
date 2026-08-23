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
import { syncEventReminders } from "@/core/reminders/prep";
import { deadline } from "@/lib/budget";

export const maxDuration = 300;

/**
 * The platform kills this function at `maxDuration`. We stop before that, on
 * purpose, with 20 seconds to spare — because a tick that ends itself can say
 * what it managed to do, and a tick the platform kills cannot say anything.
 */
const BUDGET_MS = 280_000;

/**
 * Scheduler tick (wire to Vercel Cron / Supabase cron). Fires due reminders:
 * marks them and mirrors each into a high-priority task so it surfaces
 * everywhere until richer channels (push/email) land.
 *
 * ── Ordering is the design ─────────────────────────────────────────────────
 *
 * These steps run in descending order of how much it matters that they ran
 * today, because that is the order in which the time budget gets spent. If the
 * tick runs out of road, what it drops is the housekeeping at the bottom —
 * which loses nothing, since the next tick will do it — rather than the
 * reminders at the top, which are the one thing here with a deadline.
 *
 * Each step also carries its own ceiling. Every one of these used to be
 * `.catch()`-guarded and nothing more, which handles a step that fails but not
 * a step that hangs; production was hitting the runtime timeout and losing the
 * entire tail of the chain with no error attributing it to anything.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const d = deadline(BUDGET_MS);

  // Shared with /api/reminders/tick, which the app polls while it is open —
  // the cron is the floor, not the only path. See core/reminders/fire.ts.
  // Prep nudges for anything new in the calendar, then deliver what is due.
  const prep = await d.step("prep", syncEventReminders, 20_000, { created: 0, lead: 0 });
  const fired = await d.step("reminders", fireDueReminders, 20_000, []);

  const automationsRan = await d.step("automations", runDueAutomations, 40_000, 0);
  const notifications = await d.step("notifications", runNotifications, 20_000, {});
  const anticipated = await d.step("anticipate", runAnticipation, 30_000, 0);
  const dailyDigestSaved = await d.step("dailyDigest", maybeSaveDailyDigest, 30_000, false);
  const weeklyReviewSent = await d.step("weeklyReview", maybeSendWeeklyReview, 30_000, false);
  const cardsGenerated = await d.step("cards", generateDailyCards, 30_000, 0);
  // Safety net: if the 9pm tick was missed (a deploy, an outage), this still
  // closes the day out — the function checks the hour and the day itself, so
  // running it here cannot double-nudge.
  const dayClosed = await d.step("closeDay", closeHealthDay, 20_000, null);
  // Cheap and idempotent — re-syncing updates rather than duplicating, so this
  // can run every tick without a guard.
  const hevy = await d.step("hevy", syncHevy, 20_000, { ok: false, added: 0, updated: 0 });
  const careerScan = await d.step("careerScan", maybeScanInbox, 30_000, { added: 0, updated: 0 });
  // Once a day at most; the guard lives in the function, not the schedule.
  const memory = await d.step("memory", maybeConsolidateMemories, 40_000, null);
  // Weekly, guarded on the last stored report rather than the clock, so a
  // missed week produces one at the next tick instead of waiting another seven.
  const lifeReport = (await d.step("lifeReport", maybeGenerateLifeReport, 60_000, null)) ? 1 : 0;
  // Housekeeping: the Event table is a universal store and nothing ever
  // deleted from it. Retention is per-type and conservative — see
  // core/ops/retention.ts — so this only removes bookkeeping and regenerable
  // content, never the user's own records. Last, because it is the step that
  // loses the least by waiting for the next tick.
  const pruned = (await d.step("prune", pruneEvents, 30_000, null))?.total ?? 0;

  return NextResponse.json({
    ok: true,
    fired: fired.length,
    prepCreated: prep.created,
    automationsRan,
    weeklyReviewSent,
    dailyDigestSaved,
    anticipated,
    notifications,
    cardsGenerated,
    careerScan,
    memory,
    lifeReport,
    hevy,
    dayClosed,
    pruned,
    // So a tick that ran short says so in its own response, instead of being
    // diagnosed months later from an absence of results.
    ms: d.spent(),
    skipped: d.skipped,
  });
}
