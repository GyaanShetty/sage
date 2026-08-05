import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { fetchIcs, type IcsEvent } from "@/infrastructure/integrations/ics";

/**
 * Subscribed calendars.
 *
 * The agenda only knew about Google Calendar, which means it only knew about
 * things Gyaan typed into it himself. The calendars that actually govern a
 * student's week — the timetable, the exam schedule, a society's events — are
 * published as .ics URLs by whoever runs them, and stay right without anyone
 * maintaining a copy.
 *
 * Feeds are read live rather than imported. An imported copy is wrong the
 * moment a lecture moves, and a moved lecture is exactly the case where being
 * wrong matters.
 */

const TYPE = "calendar.feed";

export interface Feed {
  id: string;
  url: string;
  label: string;
  enabled: boolean;
  addedAt: string;
  /** Set when the last read failed, so a dead feed is visible rather than silent. */
  lastError?: string | null;
  lastCheckedAt?: string | null;
}

export async function listFeeds(): Promise<Feed[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: true }).limit(50);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Feed, "id">) }));
}

export async function addFeed(url: string, label?: string): Promise<{ id: string; events: number } | { error: string }> {
  const clean = url.trim();
  if (!/^(https?|webcal):\/\//i.test(clean)) return { error: "That needs to be an http(s) or webcal URL." };

  // Read it before storing it. A feed that cannot be parsed is worth rejecting
  // at the moment he pastes it, when he still has the right page open, rather
  // than silently contributing nothing to the agenda forever after.
  const events = await fetchIcs(clean, { days: 30, feed: label });
  if (events === null) return { error: "Couldn't read that as a calendar. Check the URL is the .ics feed, not the web page." };

  const id = crypto.randomUUID();
  await db.from("Event").insert({
    id, userId: DEFAULT_USER_ID, type: TYPE,
    payload: {
      url: clean,
      label: (label?.trim() || guessLabel(clean)).slice(0, 60),
      enabled: true,
      addedAt: new Date().toISOString(),
      lastError: null,
      lastCheckedAt: new Date().toISOString(),
    },
  });
  return { id, events: events.length };
}

export async function updateFeed(id: string, patch: Partial<Feed>): Promise<void> {
  const { data } = await db.from("Event").select("payload").eq("id", id).eq("userId", DEFAULT_USER_ID).maybeSingle();
  if (!data) return;
  const merged = { ...(data.payload as object), ...patch };
  delete (merged as { id?: string }).id;
  await db.from("Event").update({ payload: merged }).eq("id", id);
}

export async function removeFeed(id: string): Promise<void> {
  await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
}

function guessLabel(url: string): string {
  try {
    return new URL(url.replace(/^webcal:/i, "https:")).hostname.replace(/^www\./, "");
  } catch {
    return "Calendar";
  }
}

/**
 * Events from every enabled feed.
 *
 * Feeds are read in parallel and a broken one never sinks the rest: a dead
 * URL records its error and contributes nothing, which is the correct
 * behaviour for an agenda — a missing society calendar must not hide today's
 * lectures.
 */
export async function feedEvents(days = 14): Promise<IcsEvent[]> {
  const feeds = (await listFeeds()).filter((f) => f.enabled);
  if (feeds.length === 0) return [];

  const results = await Promise.all(
    feeds.map(async (f) => {
      const events = await fetchIcs(f.url, { days, feed: f.label });
      // Recording every check would be a write per feed per agenda load, so
      // only a change in state is stored.
      const failed = events === null;
      if (failed !== !!f.lastError) {
        await updateFeed(f.id, {
          lastError: failed ? "Unreadable — the URL may have moved or expired." : null,
          lastCheckedAt: new Date().toISOString(),
        }).catch(() => undefined);
      }
      return events ?? [];
    }),
  );

  return results.flat().sort((a, b) => a.start.localeCompare(b.start));
}
