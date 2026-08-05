import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";

/**
 * A pulse SAGE does not get from Vercel.
 *
 * The free plan allows two cron invocations a day. Everything time-sensitive
 * has been bent around that ceiling: reminders arrive at the next of two
 * ticks, price alerts were never evaluated at all, and "9pm" meant "whenever
 * 15:30 UTC comes round". No amount of care inside the app fixes a scheduler
 * that runs twice.
 *
 * So the schedule moves outside. Any minute-granularity caller — a Cloudflare
 * Worker cron, a free cron service, the app itself while open — hits /api/beat,
 * and this decides what is actually due. The caller carries no schedule
 * knowledge whatsoever; it just knocks, and the knocking is free.
 *
 * Two properties make that safe:
 *
 *   1. Every job records when it last ran, so cadence is enforced here rather
 *      than by the caller. Ten beats in ten seconds run the same work once.
 *   2. Every job is already idempotent — reminders claim before sending, syncs
 *      upsert, guards live inside the functions. A duplicate beat is a no-op,
 *      not a double notification.
 */

const LAST_RUN = "ops.lastrun";

export interface Job {
  name: string;
  /** Minimum minutes between runs. */
  everyMin: number;
  /** Only run inside NSE hours (Mon-Fri, 09:15-15:30 IST). */
  marketHours?: boolean;
  /** Local hour range in which this job is allowed to run at all, [from, to). */
  hours?: [number, number];
  run: () => Promise<unknown>;
}

/** Minutes past midnight, in his timezone. */
export function localMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Weekday in his timezone, 0 = Sunday. */
export function localWeekday(now = new Date()): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/**
 * NSE hours, with a margin either side.
 *
 * A little before the open and a little after the close is deliberate: a gap
 * up is news at 09:10, and the closing print matters at 15:35. Holidays are
 * not modelled — the quote simply does not move, and an alert on an unmoved
 * price does not fire.
 */
export function inMarketHours(now = new Date()): boolean {
  const day = localWeekday(now);
  if (day === 0 || day === 6) return false;
  const min = localMinutes(now);
  return min >= 9 * 60 && min <= 15 * 60 + 45;
}

async function lastRunMap(): Promise<Record<string, string>> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", LAST_RUN)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  return ((data?.payload as Record<string, string>) ?? {});
}

async function saveRunMap(map: Record<string, string>): Promise<void> {
  const { data: existing } = await db
    .from("Event").select("id")
    .eq("userId", DEFAULT_USER_ID).eq("type", LAST_RUN)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();

  if (existing) await db.from("Event").update({ payload: map }).eq("id", existing.id);
  else await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: LAST_RUN, payload: map });
}

export function isDue(job: Job, lastRun: string | undefined, now = new Date()): boolean {
  if (job.marketHours && !inMarketHours(now)) return false;
  if (job.hours) {
    const hour = Math.floor(localMinutes(now) / 60);
    const [from, to] = job.hours;
    if (hour < from || hour >= to) return false;
  }
  if (!lastRun) return true;
  const since = (now.getTime() - new Date(lastRun).getTime()) / 60_000;
  // A clock that has gone backwards (or a bad stored value) must not park a
  // job forever.
  return !Number.isFinite(since) || since < 0 || since >= job.everyMin;
}

export interface BeatResult {
  at: string;
  ran: { job: string; ms: number; ok: boolean; result?: unknown; error?: string }[];
  skipped: string[];
}

/**
 * Run everything that is due.
 *
 * Jobs run in sequence and a failure never stops the ones behind it: this is
 * the only heartbeat, and one broken job must not take the pulse with it.
 */
export async function beat(jobs: Job[], now = new Date()): Promise<BeatResult> {
  const map = await lastRunMap().catch(() => ({} as Record<string, string>));
  const result: BeatResult = { at: now.toISOString(), ran: [], skipped: [] };

  for (const job of jobs) {
    if (!isDue(job, map[job.name], now)) { result.skipped.push(job.name); continue; }

    // Claimed before running, not after. A job that dies mid-run would
    // otherwise be retried by every beat that followed it.
    map[job.name] = now.toISOString();

    const started = Date.now();
    try {
      const out = await job.run();
      result.ran.push({ job: job.name, ms: Date.now() - started, ok: true, result: out });
    } catch (e) {
      result.ran.push({ job: job.name, ms: Date.now() - started, ok: false, error: (e as Error).message });
    }
  }

  if (result.ran.length) await saveRunMap(map).catch(() => undefined);
  return result;
}
