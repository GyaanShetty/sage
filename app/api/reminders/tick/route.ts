import { NextResponse } from "next/server";
import { fireDueReminders, nextReminder } from "@/core/reminders/fire";
import { syncEventReminders } from "@/core/reminders/prep";
import { within } from "@/lib/budget";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Deliver anything that has come due.
 *
 * Deliberately cheap and safe to call often: one indexed query when nothing is
 * due, and a status claim that makes double-firing impossible when something
 * is. The app polls this while it is open, and an external minute-granularity
 * scheduler can hit it too — which is the only way to get exact delivery on a
 * plan that allows two crons a day.
 *
 * Because the open app polls this, a hang here is not one lost tick — it is a
 * request that stays open for the full 30 seconds on every poll, from every
 * tab. The budgets below are well under `maxDuration` so this route always
 * answers, and answers quickly, even when the calendar sync is unreachable.
 */
export async function GET() {
  // Generate the prep nudges for anything new in the calendar before firing,
  // so an event added moments ago is covered on this very tick. Idempotent —
  // see core/reminders/prep.ts. This is the step that reaches out over the
  // network, so it gets the tightest leash: a stale prep nudge arrives on the
  // next poll a minute later, which nobody notices. A stuck poll they do.
  const prep = await within(syncEventReminders(), 6_000, { created: 0, lead: 0 });

  // Firing is local database work and is the actual point of the route, so it
  // gets the larger share of the budget.
  const fired = await within(fireDueReminders(), 8_000, []);
  const next = await within(nextReminder(), 4_000, null);
  return NextResponse.json({ ok: true, data: { fired, next, prep } });
}
