import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";

/**
 * A nudge before every commitment.
 *
 * A calendar entry tells you a thing exists; it does not get you to it. The
 * useful moment is the one just before — long enough to close what you are
 * doing, short enough that you have not forgotten again by the time it starts.
 *
 * These are generated from the calendar rather than written by hand, so
 * anything you or SAGE puts in the calendar is covered automatically. They
 * ride the same Reminder table and the same delivery path as everything else,
 * which means the minute-accurate ticker fires them too — a prep reminder that
 * arrives at the next twice-daily cron would be worthless.
 */

const LEAD_KEY = "reminders.lead";
export const DEFAULT_LEAD_MIN = 15;

/** Minutes of warning before an event. Configurable, because 15 is a guess. */
export async function getLeadMinutes(): Promise<number> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", LEAD_KEY)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  const n = Number((data?.payload as { minutes?: number } | null)?.minutes);
  return Number.isFinite(n) && n > 0 && n <= 240 ? n : DEFAULT_LEAD_MIN;
}

export async function setLeadMinutes(minutes: number): Promise<number> {
  const clean = Math.max(1, Math.min(240, Math.round(minutes)));
  await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: LEAD_KEY, payload: { minutes: clean },
  });
  return clean;
}

/**
 * Create the missing prep reminders for upcoming events.
 *
 * Idempotent by design: each reminder carries the event's id and start time in
 * its text marker, so re-running this — which happens on every cron tick and
 * every app open — never doubles up. Moving an event changes the marker, which
 * is correct: the old reminder is for a time that no longer exists.
 */
export async function syncEventReminders(): Promise<{ created: number; lead: number }> {
  const lead = await getLeadMinutes();
  const events = await listUpcomingEvents(15).catch(() => null);
  if (!events?.length) return { created: 0, lead };

  const now = Date.now();

  // Existing prep reminders, by marker, so nothing is created twice.
  const { data: existing } = await db
    .from("Reminder")
    .select("text")
    .eq("userId", DEFAULT_USER_ID)
    .like("text", "%⟨prep:%")
    .limit(200);
  const seen = new Set(
    (existing ?? [])
      .map((r) => /⟨prep:([^⟩]+)⟩/.exec(String(r.text))?.[1])
      .filter(Boolean) as string[],
  );

  const rows: { id: string; userId: string; text: string; remindAt: string }[] = [];

  for (const e of events) {
    // All-day events have no moment to be early for.
    if (e.allDay || !e.start || !e.start.includes("T")) continue;

    const startsAt = new Date(e.start).getTime();
    if (Number.isNaN(startsAt)) continue;

    const remindAt = startsAt - lead * 60_000;
    // Already past, or the event starts sooner than the lead time — a reminder
    // due in the past would fire immediately and read as noise about something
    // you are already late for.
    if (remindAt <= now) continue;

    const marker = `${e.id ?? e.summary}@${new Date(startsAt).toISOString()}`;
    if (seen.has(marker)) continue;

    rows.push({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      text: `${e.summary} in ${lead} minutes${e.location ? ` · ${e.location}` : ""} ⟨prep:${marker}⟩`,
      remindAt: new Date(remindAt).toISOString(),
    });
  }

  if (rows.length) await db.from("Reminder").insert(rows);
  return { created: rows.length, lead };
}

/**
 * The marker is bookkeeping, not something to read aloud.
 *
 * It lives in the text because the Reminder table has no spare column for it,
 * and adding a migration for a bracketed suffix would be the more invasive
 * choice — but it must never reach a notification.
 */
export function stripMarker(text: string): string {
  return text.replace(/\s*⟨prep:[^⟩]+⟩\s*/g, " ").trim();
}
