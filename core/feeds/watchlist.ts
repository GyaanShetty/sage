/**
 * The YouTube watchlist, owned by Gyaan rather than by an environment
 * variable.
 *
 * The channels were baked into `MORNING_YT_CHANNELS`, which means changing
 * what he watches requires a redeploy — the same friction that made the API
 * keys worth moving into a store, for the same reason.
 *
 * Stored as `Event` rows like places and keys: no migration, and the generic
 * trash and backup paths already cover it.
 */

export type FeedKind = "channel" | "video";

export interface FeedSource {
  id: string;
  kind: FeedKind;
  /** UC… channel id, an @handle, or an 11-character video id. */
  ref: string;
  /** What he pasted, kept so the row can be recognised in a list. */
  url: string;
  at: string;
}

/**
 * Read a YouTube URL structurally.
 *
 * Every branch here matches a shape YouTube actually serves. Nothing is
 * inferred from a substring: a "guess" that turns `youtube.com/results?q=…`
 * into a channel id produces a feed that silently returns nothing, which is
 * far worse than refusing the paste and saying so.
 *
 * Pure, exported, and unit-tested — the awkward cases are all real URLs
 * (a share link with a tracking parameter, a watch URL inside a playlist,
 * a handle with a dot in it) and none of them can be checked in a browser.
 */
export function parseFeedUrl(raw: string): { kind: FeedKind; ref: string } | null {
  const text = raw.trim();
  if (!text) return null;

  // A bare handle or channel id, pasted without the URL around it.
  if (/^@[\w.\-]{3,30}$/.test(text)) return { kind: "channel", ref: text };
  if (/^UC[\w-]{22}$/.test(text)) return { kind: "channel", ref: text };

  let u: URL;
  try {
    u = new URL(text.startsWith("http") ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  // youtu.be/<id> — the share link. The id is the whole path.
  if (host === "youtu.be") {
    const id = parts[0] ?? "";
    return /^[\w-]{11}$/.test(id) ? { kind: "video", ref: id } : null;
  }

  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") return null;

  // /watch?v=<id> — the ?list= of a playlist watch URL is deliberately
  // ignored; he pasted a video, and subscribing to the playlist it happened
  // to be opened from is not what he asked for.
  if (parts[0] === "watch") {
    const id = u.searchParams.get("v") ?? "";
    return /^[\w-]{11}$/.test(id) ? { kind: "video", ref: id } : null;
  }

  // /shorts/<id> and /live/<id> are videos wearing a different path.
  if ((parts[0] === "shorts" || parts[0] === "live") && /^[\w-]{11}$/.test(parts[1] ?? "")) {
    return { kind: "video", ref: parts[1] };
  }

  // /channel/UC…
  if (parts[0] === "channel" && /^UC[\w-]{22}$/.test(parts[1] ?? "")) {
    return { kind: "channel", ref: parts[1] };
  }

  // /@handle, and the legacy /c/name and /user/name forms. All three resolve
  // to a channel id later, by the same lookup.
  if (parts[0]?.startsWith("@")) return { kind: "channel", ref: parts[0] };
  if ((parts[0] === "c" || parts[0] === "user") && parts[1]) return { kind: "channel", ref: `@${parts[1]}` };

  return null;
}

/* ── store ───────────────────────────────────────────────────────────────
   Kept below the parser so the pure half stays importable from a client
   component: core/places splits for the same reason — the db module drags
   node built-ins into anything that imports it. */

import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

const TYPE = "feed.source";

export async function listFeedSources(): Promise<FeedSource[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: true })
    .limit(100);
  return (data ?? []).map((r) => r.payload as FeedSource);
}

export async function addFeedSource(url: string): Promise<FeedSource | null> {
  const parsed = parseFeedUrl(url);
  if (!parsed) return null;

  // Adding the same channel twice yields duplicate videos in the pane, which
  // reads as a bug rather than as a double subscription.
  const existing = await listFeedSources();
  const already = existing.find((f) => f.ref.toLowerCase() === parsed.ref.toLowerCase());
  if (already) return already;

  const row: FeedSource = {
    id: crypto.randomUUID(),
    kind: parsed.kind,
    ref: parsed.ref,
    url: url.trim().slice(0, 300),
    at: new Date().toISOString(),
  };
  const { error } = await db
    .from("Event")
    .insert({ id: row.id, userId: DEFAULT_USER_ID, type: TYPE, payload: row });
  return error ? null : row;
}

export async function removeFeedSource(id: string): Promise<boolean> {
  const { error } = await db.from("Event").delete().eq("id", id).eq("type", TYPE);
  return !error;
}

/** Just the channel refs, for the feed fetcher. */
export async function watchedChannels(): Promise<string[]> {
  return (await listFeedSources()).filter((f) => f.kind === "channel").map((f) => f.ref);
}
