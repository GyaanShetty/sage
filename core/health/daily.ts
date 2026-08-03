import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listDays, getGoals, today } from "@/core/health/store";
import { sendPush } from "@/infrastructure/push";
import { TZ } from "@/lib/config";

/**
 * The 9pm step check.
 *
 * One thing has to be said plainly: a server cannot read your step count. The
 * figure lives in Apple Health on your phone, behind a permission no web
 * request can cross, so nothing running on Vercel can go and fetch it. Any
 * design that claims otherwise is either lying or scraping a login.
 *
 * What the server CAN do is close the day out at nine: record what arrived,
 * and if nothing did, say so — on your phone, where you can fix it in a tap.
 * That turns "it isn't tracking my steps" into either a stored number or a
 * visible nudge, instead of silence.
 *
 * The automatic half is an iOS Shortcut posting to /api/health on a 9pm
 * personal automation. This function is what makes its absence noticeable.
 */

const TYPE = "health.dayClosed";
const CLOSE_HOUR = 21;

function hourIn(tz: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()));
}

export interface DayClose {
  day: string;
  steps: number | null;
  goal: number;
  metGoal: boolean;
  /** Steps versus the trailing average, in %. Null until there is history. */
  vsAverage: number | null;
  nudged: boolean;
  at: string;
}

/** Already closed today? Closing twice would double-nudge. */
async function closedToday(day: string): Promise<boolean> {
  const { data } = await db
    .from("Event")
    .select("id")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>day", day)
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function closeHealthDay(force = false): Promise<DayClose | null> {
  if (!force && hourIn(TZ) < CLOSE_HOUR) return null;

  const day = today();
  if (!force && (await closedToday(day))) return null;

  const [series, goals] = await Promise.all([listDays(30), getGoals()]);
  const todayRow = series.find((d) => d.day === day) ?? null;
  const steps = todayRow?.steps ?? null;

  // Trailing average over days that actually reported — including the silent
  // ones as zero would drag the baseline down and make every day look good.
  const past = series.filter((d) => d.day !== day && d.steps != null).map((d) => d.steps as number);
  const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
  const vsAverage = avg && avg > 0 && steps != null ? Math.round(((steps - avg) / avg) * 100) : null;

  const metGoal = steps != null && steps >= goals.steps;
  let nudged = false;

  if (steps == null) {
    await sendPush({
      title: "Steps not logged today",
      body: "Nothing came through from your phone. Tap to add today's count.",
      tag: `steps-${day}`,
      url: "/health",
    }).catch(() => 0);
    nudged = true;
  } else if (!metGoal) {
    const short = goals.steps - steps;
    await sendPush({
      title: `${steps.toLocaleString()} steps today`,
      body: `${short.toLocaleString()} short of ${goals.steps.toLocaleString()}. A walk before bed would do it.`,
      tag: `steps-${day}`,
      url: "/health",
    }).catch(() => 0);
    nudged = true;
  }

  const close: DayClose = { day, steps, goal: goals.steps, metGoal, vsAverage, nudged, at: new Date().toISOString() };
  await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE, payload: close,
  });
  return close;
}

/** Recent day closes, for the health page's streak and history. */
export async function listDayCloses(limit = 30): Promise<DayClose[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => r.payload as DayClose).filter((d) => d?.day);
}
