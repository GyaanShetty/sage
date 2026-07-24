import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { runDueAutomations } from "@/core/automation/run";
import { maybeSendWeeklyReview } from "@/core/review/weekly";
import { maybeSaveDailyDigest } from "@/core/review/daily";
import { runAnticipation } from "@/core/anticipate/engine";
import { sendPush } from "@/infrastructure/push";

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

  const { data: due } = await db
    .from("Reminder")
    .select("id, text, remindAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("status", "pending")
    .lte("remindAt", new Date().toISOString())
    .limit(50);

  for (const reminder of due ?? []) {
    await db.from("Task").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      title: `⏰ ${reminder.text}`,
      priority: 0,
      source: "automation",
    });
    await db.from("Reminder").update({ status: "fired" }).eq("id", reminder.id);
    await db.from("Event").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      type: "reminder.fired",
      payload: { text: reminder.text, remindAt: reminder.remindAt },
    });
    // Reach the user's devices directly if they've enabled push.
    await sendPush({ title: "⏰ Reminder", body: reminder.text, tag: `reminder-${reminder.id}`, url: "/workspace" }).catch(() => 0);
  }

  const automationsRan = await runDueAutomations().catch(() => 0);
  const weeklyReviewSent = await maybeSendWeeklyReview().catch(() => false);
  const dailyDigestSaved = await maybeSaveDailyDigest().catch(() => false);
  const anticipated = await runAnticipation().catch(() => 0);

  return NextResponse.json({ ok: true, fired: due?.length ?? 0, automationsRan, weeklyReviewSent, dailyDigestSaved, anticipated });
}
