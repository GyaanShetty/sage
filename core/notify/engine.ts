import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { searchGmail } from "@/infrastructure/integrations/google";
import { getMarkets } from "@/infrastructure/markets";
import { getDailyChallenge, getLeetStats } from "@/infrastructure/integrations/leetcode";
import { sendPush } from "@/infrastructure/push";
import { pipelineReport, needsAttention, type AppInsight } from "@/core/career/pipeline";
import { TZ, tzHour, startOfTodayUtc } from "@/lib/config";

const LEET_USER = process.env.LEETCODE_USERNAME ?? "gyaanshetty";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** Has a notification with this key already gone out today? */
async function seenToday(key: string): Promise<boolean> {
  const { data } = await db
    .from("Event")
    .select("id")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "notify.sent")
    .gte("createdAt", startOfTodayUtc())
    .contains("payload", { key })
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function markSent(key: string): Promise<void> {
  await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "notify.sent", payload: { key } });
}

/**
 * Morning brief — the day's headline: open tasks, the next problem, and where
 * the streak stands. Nudges the user into the morning block.
 *
 * The window has to contain a tick to ever fire, and that is the bug this
 * fixes. Vercel's free plan allows two daily cron invocations, which land at
 * 08:30 and 21:00 IST. The old window was 5am to 8am, so the 08:30 tick was
 * one minute too late and this notification had never once been sent. The
 * windows below are now written around the ticks that actually exist rather
 * than the hours we would have picked given an hourly scheduler.
 */
async function morningBrief(): Promise<number> {
  if (tzHour() < 5 || tzHour() >= 12) return 0;
  if (await seenToday("morning")) return 0;

  const [{ data: tasks }, stats] = await Promise.all([
    db.from("Task").select("title").eq("userId", DEFAULT_USER_ID).in("status", ["todo", "doing"]).limit(50),
    getLeetStats(LEET_USER).catch(() => null),
  ]);

  const open = (tasks ?? []).length;
  const bits: string[] = [];
  bits.push(open ? `${open} open task${open === 1 ? "" : "s"}` : "a clear slate");
  if (stats?.streak) bits.push(`${stats.streak}-day LeetCode streak`);

  await sendPush({
    title: "☀️ Good morning, sir",
    body: `${bits.join(" · ")}. Your morning block is ready.`,
    tag: "morning",
    url: "/morning",
  });
  await markSent("morning");
  return 1;
}

/**
 * Market brief — notable moves across the tracked markets, only surfacing if
 * something actually moved. Runs on the morning tick (08:30 IST), which is
 * before the Indian open, so this reads as an overnight/pre-open summary.
 */
async function marketBrief(): Promise<number> {
  if (tzHour() < 5 || tzHour() >= 14) return 0;
  if (await seenToday("market")) return 0;

  const markets = await getMarkets().catch(() => null);
  if (!markets?.length) return 0;

  // Rank by absolute move; only speak up if something crossed a real threshold.
  const movers = [...markets].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
  const notable = movers.filter((c) => Math.abs(c.change24h) >= 2).slice(0, 3);
  if (!notable.length) return 0;

  const body = notable
    .map((c) => `${c.symbol} ${c.change24h >= 0 ? "▲" : "▼"}${Math.abs(c.change24h).toFixed(1)}%`)
    .join("  ·  ");

  await sendPush({
    title: "📈 Overnight moves",
    body,
    tag: "market",
    url: "/markets",
  });
  await markSent("market");
  return 1;
}

/**
 * Evening task brief — fires once in the 6pm IST window: what's still pending
 * today and what's due across the rest of the week. Keeps the user ahead of
 * deadlines without pinging all day.
 */
async function eveningTaskBrief(): Promise<number> {
  if (tzHour() < 16 || tzHour() >= 23) return 0;
  if (await seenToday("pending")) return 0;

  const { data: tasks } = await db
    .from("Task")
    .select("title, dueAt")
    .eq("userId", DEFAULT_USER_ID)
    .in("status", ["todo", "doing"])
    .limit(200);
  if (!tasks?.length) return 0;

  const now = new Date();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date();
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const dueToday = tasks.filter((t) => t.dueAt && new Date(t.dueAt) <= endOfToday);
  const overdue = dueToday.filter((t) => t.dueAt && new Date(t.dueAt) < now);
  const dueWeek = tasks.filter(
    (t) => t.dueAt && new Date(t.dueAt) > endOfToday && new Date(t.dueAt) <= endOfWeek,
  );

  // Only ping if there's something time-bound to act on.
  if (!dueToday.length && !dueWeek.length) return 0;

  const parts: string[] = [];
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  const todayPending = dueToday.length - overdue.length;
  if (todayPending > 0) parts.push(`${todayPending} due today`);
  if (dueWeek.length) parts.push(`${dueWeek.length} this week`);

  const top = (overdue[0] ?? dueToday[0] ?? dueWeek[0])?.title ?? "";
  await sendPush({
    title: "🗓️ Pending tasks, sir",
    body: `${parts.join(" · ")}${top ? `. Top: "${top}"` : ""}.`,
    tag: "pending",
    url: "/workspace",
  });
  await markSent("pending");
  return 1;
}

/**
 * Genuinely important, time-sensitive emails (internships, deadlines, offers)
 * — pushed as they arrive, deduped per subject, capped so it never floods.
 */
async function importantEmails(): Promise<number> {
  const q = 'is:unread newer_than:2d (internship OR "application" OR deadline OR interview OR "offer letter" OR "last date" OR shortlisted OR "assessment")';
  const emails = await searchGmail(q, 8).catch(() => null);
  if (!emails?.length) return 0;
  let sent = 0;
  for (const e of emails) {
    if (sent >= 2) break;
    const key = `email:${e.subject}`.slice(0, 120);
    if (await seenToday(key)) continue;
    await sendPush({
      title: "📋 Important email",
      body: `${e.from}: ${e.subject}`,
      tag: key,
      url: "/dashboard",
    });
    await markSent(key);
    sent++;
  }
  return sent;
}

/** Evening LeetCode nudge if today's problem is still unsolved (after 6pm IST). */
async function leetcodeNudge(): Promise<number> {
  if (tzHour() < 18 || tzHour() >= 22) return 0;
  if (await seenToday("leetcode")) return 0;
  const [stats, daily] = await Promise.all([
    getLeetStats(LEET_USER).catch(() => null),
    getDailyChallenge().catch(() => null),
  ]);
  if (!stats || stats.todaySolved > 0) return 0; // already solved (or unknown) → stay quiet
  await sendPush({
    title: "🧩 LeetCode still pending",
    body: daily ? `Today's "${daily.title}" (${daily.difficulty}) is unsolved — keep the ${stats.streak}-day streak alive, sir.` : "Today's problem is still unsolved — keep the streak alive, sir.",
    tag: "leetcode",
    url: "/morning",
  });
  await markSent("leetcode");
  return 1;
}

/**
 * Career pipeline nudge — a deadline inside three days, or an application that
 * has gone quiet. Both were already tracked and neither was ever surfaced, so
 * a deadline could pass with the card sitting right there on the page.
 * Morning only, deduped per application per day.
 */
async function careerNudge(): Promise<number> {
  if (tzHour() < 8 || tzHour() >= 12) return 0;
  const { insights } = await pipelineReport().catch(() => ({ insights: [] as AppInsight[] }));
  const { dueSoon, stale } = needsAttention(insights);
  let sent = 0;

  for (const i of dueSoon) {
    if (sent >= 2) break;
    const key = `career-due:${i.id}:${i.daysToDeadline}`;
    if (await seenToday(key)) continue;
    const when = i.daysToDeadline === 0 ? "today" : i.daysToDeadline === 1 ? "tomorrow" : `in ${i.daysToDeadline} days`;
    await sendPush({
      title: "💼 Application deadline",
      body: `${i.company} — ${i.role} closes ${when}, sir.`,
      tag: key,
      url: "/career",
    });
    await markSent(key);
    sent++;
  }

  // One summary for everything that has gone quiet, rather than a push each.
  if (stale.length && !(await seenToday("career-stale"))) {
    const lead = stale[0];
    await sendPush({
      title: "💼 Pipeline has gone quiet",
      body: `${stale.length} application${stale.length === 1 ? "" : "s"} untouched for weeks — ${lead.company} is ${lead.daysInStage} days in ${lead.stage}.`,
      tag: "career-stale",
      url: "/career",
    });
    await markSent("career-stale");
    sent++;
  }
  return sent;
}

/**
 * Full notification sweep — called each cron tick. Three scheduled briefs
 * (5am morning · 9am markets · 6pm pending tasks) plus two important-only
 * event channels (time-sensitive emails, evening LeetCode streak). Every
 * channel dedupes itself so a frequent cron never spams.
 */
export async function runNotifications(): Promise<Record<string, number>> {
  const [morning, market, pending, email, leetcode, career] = await Promise.all([
    morningBrief().catch(() => 0),
    marketBrief().catch(() => 0),
    eveningTaskBrief().catch(() => 0),
    importantEmails().catch(() => 0),
    leetcodeNudge().catch(() => 0),
    careerNudge().catch(() => 0),
  ]);
  return { morning, market, pending, email, leetcode, career };
}
