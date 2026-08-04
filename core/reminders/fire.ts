import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { sendPush } from "@/infrastructure/push";

/**
 * Firing reminders on time, on a scheduler that runs twice a day.
 *
 * This needs saying plainly: Vercel's free plan gives two cron invocations a
 * day, at 08:30 and 21:00 IST. A reminder set for 3pm was therefore delivered
 * at 9pm — six hours late, which is not a reminder, it is a note about
 * something you have already missed.
 *
 * The sweep itself was never the problem; where it was called from was. It
 * lives here now so three things can drive it:
 *
 *   1. The cron, twice a day — the floor, and the only one that works with
 *      the app closed on a free plan.
 *   2. The app itself, whenever it is open. If SAGE is on a screen, reminders
 *      land within a minute of their time.
 *   3. Any external scheduler you point at /api/reminders/tick. A free
 *      minute-granularity cron service makes this exact, and the endpoint is
 *      safe to hit as often as you like.
 *
 * Every path shares the same guard: a reminder is claimed by status before
 * anything is sent, so two callers racing cannot double-notify.
 */

export interface FiredReminder {
  id: string;
  text: string;
  remindAt: string;
  /** How late it was, in minutes. Worth knowing when it is not zero. */
  lateMin: number;
}

export async function fireDueReminders(limit = 50): Promise<FiredReminder[]> {
  const now = Date.now();

  const { data: due } = await db
    .from("Reminder")
    .select("id, text, remindAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("status", "pending")
    .lte("remindAt", new Date(now).toISOString())
    .order("remindAt", { ascending: true })
    .limit(limit);

  const fired: FiredReminder[] = [];

  for (const reminder of due ?? []) {
    // Claim it FIRST. The app polls this and so does the cron, so without a
    // claim before the side effects a reminder could be pushed twice — and
    // the second copy always arrives as the more annoying one.
    const { data: claimed } = await db
      .from("Reminder")
      .update({ status: "fired" })
      .eq("id", reminder.id)
      .eq("status", "pending")     // no-op if someone else got there first
      .select("id");
    if (!claimed?.length) continue;

    await db.from("Task").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      title: `⏰ ${reminder.text}`,
      priority: 0,
      source: "automation",
    });
    await db.from("Event").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      type: "reminder.fired",
      payload: { text: reminder.text, remindAt: reminder.remindAt },
    });
    await sendPush({
      title: "⏰ Reminder",
      body: reminder.text,
      tag: `reminder-${reminder.id}`,
      url: "/workspace",
    }).catch(() => 0);

    fired.push({
      id: reminder.id as string,
      text: reminder.text as string,
      remindAt: reminder.remindAt as string,
      lateMin: Math.max(0, Math.round((now - new Date(reminder.remindAt as string).getTime()) / 60_000)),
    });
  }

  return fired;
}

/** The next pending reminder, so the UI can say when the next nudge is due. */
export async function nextReminder(): Promise<{ text: string; remindAt: string } | null> {
  const { data } = await db
    .from("Reminder")
    .select("text, remindAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("status", "pending")
    .gt("remindAt", new Date().toISOString())
    .order("remindAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? { text: data.text as string, remindAt: data.remindAt as string } : null;
}
