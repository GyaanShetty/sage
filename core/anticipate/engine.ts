import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";
import { getWeather } from "@/infrastructure/weather";
import { sendPush } from "@/infrastructure/push";
import { TZ, fmt } from "@/lib/config";

const WARN_WITHIN_MIN = 45; // heads-up when an event is this soon
const LEAVE_HINT_MIN = 35; // if it has a location and is this close, suggest leaving

/**
 * Anticipation: SAGE reasons over the next few hours and warns BEFORE you ask —
 * "your 4 o'clock begins in half an hour, and it's across town." Fires a push
 * (reaches the phone even when the app is closed) once per event, and folds a
 * rain heads-up in when relevant. Deduped via anticipate.warned Events.
 *
 * Called from the cron tick — pair with a 15-minute cron for tight timing;
 * hourly still gives a solid ~45-minute warning.
 */
export async function runAnticipation(): Promise<number> {
  const events = await listUpcomingEvents(8).catch(() => null);
  if (!events?.length) return 0;

  const now = Date.now();
  // What have we already warned about today?
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const { data: warnedRows } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "anticipate.warned")
    .gte("createdAt", `${day}T00:00:00`)
    .limit(200);
  const warned = new Set((warnedRows ?? []).map((r) => (r.payload as { key?: string })?.key).filter(Boolean));

  let weatherRainy: string | null = null;
  try {
    const w = await getWeather();
    if (w && /rain|drizzle|shower|thunder/i.test(w.label)) weatherRainy = w.label.toLowerCase();
  } catch {
    /* weather optional */
  }

  let sent = 0;
  for (const ev of events) {
    if (ev.allDay) continue;
    const start = new Date(ev.start).getTime();
    if (Number.isNaN(start)) continue;
    const minsAway = (start - now) / 60000;
    if (minsAway < 0 || minsAway > WARN_WITHIN_MIN) continue;

    const key = `${ev.id ?? ev.summary}-${ev.start}`;
    if (warned.has(key)) continue;

    const whenTxt = minsAway < 1 ? "now" : `in about ${Math.round(minsAway)} minute${Math.round(minsAway) === 1 ? "" : "s"}`;
    let body = `${ev.summary} begins ${whenTxt}`;
    if (ev.location) {
      body += ` at ${ev.location}`;
      if (minsAway <= LEAVE_HINT_MIN) body += " — you'll want to set off soon";
    }
    body += ".";
    if (weatherRainy) body += ` It's ${weatherRainy} out — take an umbrella.`;

    await sendPush({
      title: `⏱ ${fmt(new Date(start), { hour: "2-digit", minute: "2-digit", hour12: false })} · upcoming`,
      body,
      tag: `anticipate-${key}`,
      url: "/dashboard",
    }).catch(() => 0);

    await db.from("Event").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      type: "anticipate.warned",
      payload: { key, summary: ev.summary },
    });
    sent++;
  }
  return sent;
}
