import { NextResponse } from "next/server";
import { fireDueReminders, nextReminder } from "@/core/reminders/fire";
import { syncEventReminders } from "@/core/reminders/prep";

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
 */
export async function GET() {
  // Generate the prep nudges for anything new in the calendar before firing,
  // so an event added moments ago is covered on this very tick. Idempotent —
  // see core/reminders/prep.ts.
  const prep = await syncEventReminders().catch(() => ({ created: 0, lead: 0 }));

  const fired = await fireDueReminders().catch(() => []);
  const next = await nextReminder().catch(() => null);
  return NextResponse.json({ ok: true, data: { fired, next, prep } });
}
