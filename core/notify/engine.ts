import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listUpcomingEvents, searchGmail } from "@/infrastructure/integrations/google";
import { getMarkets } from "@/infrastructure/markets";
import { sendPush } from "@/infrastructure/push";
import { TZ, tzHour, fmt } from "@/lib/config";

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
    .gte("createdAt", `${today()}T00:00:00`)
    .contains("payload", { key })
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function markSent(key: string): Promise<void> {
  await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "notify.sent", payload: { key } });
}

/** Consolidated morning update (once, ~6–10am IST). */
async function morningUpdate(): Promise<number> {
  if (tzHour() < 6 || tzHour() >= 11) return 0;
  if (await seenToday("morning")) return 0;

  const [{ data: tasks }, events, markets] = await Promise.all([
    db.from("Task").select("title, dueAt").eq("userId", DEFAULT_USER_ID).in("status", ["todo", "doing"]).limit(50),
    listUpcomingEvents(3).catch(() => null),
    getMarkets().catch(() => null),
  ]);

  const open = (tasks ?? []).length;
  const bits: string[] = [];
  bits.push(open ? `${open} open task${open === 1 ? "" : "s"}` : "a clear task list");
  const nextEv = (events ?? [])[0];
  if (nextEv) bits.push(`next: ${nextEv.summary} at ${fmt(new Date(nextEv.start), { hour: "2-digit", minute: "2-digit", hour12: false })}`);
  const btc = (markets ?? []).find((c) => /btc|bitcoin/i.test(c.symbol));
  if (btc) bits.push(`BTC ${btc.change24h >= 0 ? "up" : "down"} ${Math.abs(btc.change24h).toFixed(1)}%`);

  await sendPush({
    title: "☀️ Good morning, sir",
    body: `${bits.join(" · ")}. Your morning block awaits.`,
    tag: "morning",
    url: "/morning",
  });
  await markSent("morning");
  return 1;
}

/** New internship / deadline / application emails → push (max 3 per run). */
async function importantEmails(): Promise<number> {
  const q = 'is:unread newer_than:7d (internship OR application OR deadline OR interview OR "offer letter" OR "last date" OR shortlisted OR "assessment")';
  const emails = await searchGmail(q, 8).catch(() => null);
  if (!emails?.length) return 0;
  let sent = 0;
  for (const e of emails) {
    if (sent >= 3) break;
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

/** Big market moves → push once per symbol per day. */
async function marketMoves(): Promise<number> {
  const markets = await getMarkets().catch(() => null);
  if (!markets?.length) return 0;
  let sent = 0;
  for (const c of markets) {
    if (Math.abs(c.change24h) < 6) continue;
    const key = `market:${c.symbol}`;
    if (await seenToday(key)) continue;
    await sendPush({
      title: `${c.change24h >= 0 ? "▲" : "▼"} ${c.symbol}`,
      body: `${c.symbol} ${c.change24h >= 0 ? "up" : "down"} ${Math.abs(c.change24h).toFixed(1)}% in 24h.`,
      tag: key,
      url: "/markets",
    });
    await markSent(key);
    sent++;
  }
  return sent;
}

/** Overdue tasks → one nudge per day. */
async function overdueTasks(): Promise<number> {
  if (await seenToday("overdue")) return 0;
  const { data: tasks } = await db
    .from("Task")
    .select("title, dueAt")
    .eq("userId", DEFAULT_USER_ID)
    .in("status", ["todo", "doing"])
    .not("dueAt", "is", null)
    .lt("dueAt", new Date().toISOString())
    .limit(20);
  if (!tasks?.length) return 0;
  await sendPush({
    title: `⚑ ${tasks.length} task${tasks.length === 1 ? "" : "s"} overdue`,
    body: `Top: "${tasks[0].title}". Clear them when you can, sir.`,
    tag: "overdue",
    url: "/workspace",
  });
  await markSent("overdue");
  return 1;
}

/** Full notification sweep — called each cron tick. Every channel dedupes
 *  itself so a 15-minute cron never spams. */
export async function runNotifications(): Promise<Record<string, number>> {
  const [morning, email, market, tasks] = await Promise.all([
    morningUpdate().catch(() => 0),
    importantEmails().catch(() => 0),
    marketMoves().catch(() => 0),
    overdueTasks().catch(() => 0),
  ]);
  return { morning, email, market, tasks };
}
