import { listUpcomingEvents, type CalendarEvent } from "@/infrastructure/integrations/google";
import { feedEvents } from "./feeds";

/**
 * One agenda, whatever it is made of.
 *
 * Google Calendar and subscribed .ics feeds are different sources of the same
 * thing, and every consumer — the brief, the prep reminders, the dashboard —
 * wants "what is coming up", not "what is in Google". Merging here rather than
 * at each call site means a subscribed timetable gets the 15-minute nudge
 * before every lecture for free, which is the whole point of subscribing.
 */

export interface MergedEvent extends CalendarEvent {
  /** Which calendar it came from — null for the primary Google one. */
  feed?: string;
}

/** Everything upcoming, soonest first, from every calendar he has. */
export async function upcomingEvents(max = 15, days = 14): Promise<MergedEvent[]> {
  const [google, feeds] = await Promise.all([
    listUpcomingEvents(max).catch(() => null),
    feedEvents(days).catch(() => []),
  ]);

  const now = Date.now();
  const merged: MergedEvent[] = [
    ...(google ?? []),
    ...feeds.map((e) => ({
      id: e.uid,
      summary: e.summary,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      ...(e.location ? { location: e.location } : {}),
      ...(e.feed ? { feed: e.feed } : {}),
    })),
  ];

  return merged
    .filter((e) => {
      const end = new Date(e.end || e.start).getTime();
      return Number.isFinite(end) && end >= now;
    })
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
    .slice(0, max);
}
