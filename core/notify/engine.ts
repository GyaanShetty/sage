import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { searchGmail } from "@/infrastructure/integrations/google";
import { getMarkets } from "@/infrastructure/markets";
import { getDailyChallenge, getLeetStats } from "@/infrastructure/integrations/leetcode";
import { pipelineReport, needsAttention, type AppInsight } from "@/core/career/pipeline";
import { TZ, tzHour, startOfTodayUtc } from "@/lib/config";
import { buildDayPicture, type DayPicture } from "@/core/brief/agenda";
import { dispatch, type Candidate } from "./rank";

const LEET_USER = process.env.LEETCODE_USERNAME ?? "gyaanshetty";

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
async function morningBrief(day: DayPicture): Promise<Candidate | null> {
  if (tzHour() < 5 || tzHour() >= 12) return null;
  if (await seenToday("morning")) return null;

  const stats = await getLeetStats(LEET_USER).catch(() => null);

  // Say the sharpest true thing, not a headcount. "3 open tasks" is a number
  // he can already see; "the client deck is 2 days overdue" is a reason to
  // open the phone.
  const bits: string[] = [];
  if (day.overdue.length) {
    const worst = day.overdue[0];
    bits.push(`${worst.title} is ${worst.overdueDays}d overdue`);
  } else if (day.dueToday.length) {
    bits.push(`${day.dueToday.length} due today, starting with ${day.dueToday[0].title}`);
  } else if (day.openCount) {
    bits.push(`${day.openCount} open, nothing overdue`);
  } else {
    bits.push("a clear slate");
  }
  if (day.next?.startsAt) {
    bits.push(`first up ${day.next.summary} at ${new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(day.next.startsAt))}`);
  }
  if (stats?.streak) bits.push(`${stats.streak}-day LeetCode streak`);

  // A day with something overdue or scheduled genuinely deserves the banner;
  // an empty one barely does.
  const score = 45 + Math.min(30, day.overdue.length * 12) + (day.next ? 10 : 0) + Math.min(10, day.dueToday.length * 5);

  return {
    key: "morning",
    score,
    title: "☀️ Good morning, sir",
    body: `${bits.join(" · ")}.`,
    url: "/morning",
    digest: day.overdue.length ? `${day.overdue.length} overdue` : `${day.openCount} open`,
  };
}

/**
 * Market brief — notable moves across the tracked markets, only surfacing if
 * something actually moved. Runs on the morning tick (08:30 IST), which is
 * before the Indian open, so this reads as an overnight/pre-open summary.
 */
async function marketBrief(day: DayPicture): Promise<Candidate | null> {
  if (tzHour() < 5 || tzHour() >= 14) return null;
  if (await seenToday("market")) return null;

  const markets = await getMarkets().catch(() => null);
  if (!markets?.length) return null;

  const movers = [...markets].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
  const notable = movers.filter((c) => Math.abs(c.change24h) >= 2).slice(0, 3);
  if (!notable.length) return null;

  // A move in something he actually holds matters more than the same move in
  // something he merely watches — that is the difference between news and his
  // money, and it should decide whether the phone buzzes.
  const held = new Set((day.portfolio ? day.markets : []).map((m) => m.symbol));
  const owned = notable.filter((c) => held.has(c.symbol));
  const biggest = Math.abs(notable[0].change24h);

  const body = notable
    .map((c) => `${c.symbol} ${c.change24h >= 0 ? "▲" : "▼"}${Math.abs(c.change24h).toFixed(1)}%`)
    .join("  ·  ");

  return {
    key: "market",
    score: Math.min(90, 25 + biggest * 4 + (owned.length ? 25 : 0)),
    title: owned.length ? "📈 Your holdings moved" : "📈 Overnight moves",
    body,
    url: "/markets",
    digest: `${notable[0].symbol} ${notable[0].change24h >= 0 ? "+" : ""}${notable[0].change24h.toFixed(1)}%`,
  };
}

/**
 * Evening task brief — fires once in the 6pm IST window: what's still pending
 * today and what's due across the rest of the week. Keeps the user ahead of
 * deadlines without pinging all day.
 */
async function eveningTaskBrief(day: DayPicture): Promise<Candidate | null> {
  if (tzHour() < 16 || tzHour() >= 23) return null;
  if (await seenToday("pending")) return null;

  // The old version rolled its own "end of today" with setHours(23,59) on a
  // server running UTC, so in IST it reached 05:29 the following morning and
  // counted tomorrow's early tasks as due today. The day picture already does
  // this correctly, in the app timezone, once.
  const weekAhead = Date.now() + 7 * 86_400_000;
  const dueWeek = day.tasks.filter(
    (t) => t.state === "soon" || (t.dueAt && new Date(t.dueAt).getTime() <= weekAhead && t.state === "later"),
  );

  if (!day.overdue.length && !day.dueToday.length && !dueWeek.length) return null;

  const parts: string[] = [];
  if (day.overdue.length) parts.push(`${day.overdue.length} overdue`);
  if (day.dueToday.length) parts.push(`${day.dueToday.length} due today`);
  if (dueWeek.length) parts.push(`${dueWeek.length} this week`);

  const top = day.headline?.title ?? "";

  return {
    key: "pending",
    score: 35 + Math.min(40, day.overdue.length * 15) + Math.min(15, day.dueToday.length * 5),
    title: "🗓️ Pending tasks, sir",
    body: `${parts.join(" · ")}${top ? `. Top: "${top}"` : ""}.`,
    url: "/workspace",
    digest: parts[0] ?? "tasks pending",
  };
}

/**
 * Genuinely important, time-sensitive emails (internships, deadlines, offers)
 * — pushed as they arrive, deduped per subject, capped so it never floods.
 */
async function importantEmails(): Promise<Candidate[]> {
  const q = 'is:unread newer_than:2d (internship OR "application" OR deadline OR interview OR "offer letter" OR "last date" OR shortlisted OR "assessment")';
  const emails = await searchGmail(q, 8).catch(() => null);
  if (!emails?.length) return [];

  const out: Candidate[] = [];
  for (const e of emails.slice(0, 4)) {
    const key = `email:${e.subject}`.slice(0, 120);
    if (await seenToday(key)) continue;
    // An interview or an offer outranks a generic "application received".
    const hot = /interview|offer|shortlist|assessment|last date/i.test(e.subject);
    out.push({
      key,
      score: hot ? 85 : 50,
      title: "📋 Important email",
      body: `${e.from}: ${e.subject}`,
      url: "/dashboard",
      digest: `mail from ${e.from}`,
    });
  }
  return out;
}

/** Evening LeetCode nudge if today's problem is still unsolved (after 6pm IST). */
async function leetcodeNudge(): Promise<Candidate | null> {
  if (tzHour() < 18 || tzHour() >= 22) return null;
  if (await seenToday("leetcode")) return null;
  const [stats, daily] = await Promise.all([
    getLeetStats(LEET_USER).catch(() => null),
    getDailyChallenge().catch(() => null),
  ]);
  if (!stats || stats.todaySolved > 0) return null; // already solved (or unknown) → stay quiet

  // A long streak is worth protecting; day one is not worth a banner.
  return {
    key: "leetcode",
    score: 25 + Math.min(40, stats.streak * 3),
    title: "🧩 LeetCode still pending",
    body: daily
      ? `Today's "${daily.title}" (${daily.difficulty}) is unsolved — keep the ${stats.streak}-day streak alive, sir.`
      : "Today's problem is still unsolved — keep the streak alive, sir.",
    url: "/morning",
    digest: stats.streak ? `${stats.streak}-day streak at risk` : "LeetCode unsolved",
  };
}

/**
 * Career pipeline nudge — a deadline inside three days, or an application that
 * has gone quiet. Both were already tracked and neither was ever surfaced, so
 * a deadline could pass with the card sitting right there on the page.
 * Morning only, deduped per application per day.
 */
async function careerNudge(): Promise<Candidate[]> {
  if (tzHour() < 8 || tzHour() >= 12) return [];
  const { insights } = await pipelineReport().catch(() => ({ insights: [] as AppInsight[] }));
  const { dueSoon, stale } = needsAttention(insights);
  const out: Candidate[] = [];

  for (const i of dueSoon.slice(0, 2)) {
    const key = `career-due:${i.id}:${i.daysToDeadline}`;
    if (await seenToday(key)) continue;
    const when = i.daysToDeadline === 0 ? "today" : i.daysToDeadline === 1 ? "tomorrow" : `in ${i.daysToDeadline} days`;
    out.push({
      key,
      // A deadline today is the single most urgent thing SAGE can tell him:
      // everything else can slip a day, this cannot.
      score: 100 - (i.daysToDeadline ?? 0) * 12,
      title: "💼 Application deadline",
      body: `${i.company} — ${i.role} closes ${when}, sir.`,
      url: "/career",
      digest: `${i.company} closes ${when}`,
    });
  }

  if (stale.length && !(await seenToday("career-stale"))) {
    const lead = stale[0];
    out.push({
      key: "career-stale",
      score: 30,
      title: "💼 Pipeline has gone quiet",
      body: `${stale.length} application${stale.length === 1 ? "" : "s"} untouched for weeks — ${lead.company} is ${lead.daysInStage} days in ${lead.stage}.`,
      url: "/career",
      digest: `${stale.length} stale application${stale.length === 1 ? "" : "s"}`,
    });
  }
  return out;
}

/**
 * Full notification sweep — called each cron tick.
 *
 * Every channel now proposes a scored candidate instead of pushing on the
 * spot. One tick used to be able to fire six separate banners; the ranking
 * sends at most two and folds the rest into the leader's trailing clause, so
 * nothing is lost but nothing is spammed either. Only what actually went out
 * is marked sent — a folded candidate has not really been delivered and is
 * free to come back tomorrow.
 */
export async function runNotifications(): Promise<Record<string, unknown>> {
  const day = await buildDayPicture().catch(() => null);
  if (!day) return { error: "no day picture" };

  const [morning, market, pending, emails, leet, career] = await Promise.all([
    morningBrief(day).catch(() => null),
    marketBrief(day).catch(() => null),
    eveningTaskBrief(day).catch(() => null),
    importantEmails().catch(() => [] as Candidate[]),
    leetcodeNudge().catch(() => null),
    careerNudge().catch(() => [] as Candidate[]),
  ]);

  const candidates: Candidate[] = [
    morning, market, pending, leet,
    ...emails, ...career,
  ].filter((c): c is Candidate => c !== null);

  const { sent, folded } = await dispatch(candidates, day);
  for (const key of sent) await markSent(key);

  return { considered: candidates.length, sent, folded };
}
