import { XMLParser } from "fast-xml-parser";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { watchedChannels } from "@/core/feeds/watchlist";

export interface Video {
  id: string;
  title: string;
  channel: string;
  published: number;
  thumb: string;
}

// Gyaan's channels — news/finance/crypto. Handles (@name) or raw UC… ids both
// work; override with MORNING_YT_CHANNELS (comma-separated).
/*
 * Channel IDs, not @handles.
 *
 * The handle resolver scrapes the channel page and takes the first UC id it
 * finds, which is frequently a *related* channel rather than the one asked
 * for. Checked by fetching each feed and reading back its title:
 * @aljazeeraenglish resolved to Al Jazeera Arabic, @CNBC to CNBC Make It,
 * @DWNews to DW Podcasts, @ycombinator to YC Root Access, @TED to TEDx Talks,
 * and @Coinbureau to a channel called Finance Bureau — a different outlet
 * altogether. Every one of those looked like it had worked.
 *
 * An ID resolves to exactly one channel or to nothing, so each of these was
 * verified against the feed's own title before it went in. Handles still work
 * if he adds one from Settings; this is only the default set.
 */
const DEFAULT_CHANNELS = [
  // Markets and money
  "UCIALMKvObZNtJ6AmdCLP7Lg",   // Bloomberg Television
  "UCvJJ_dzjViJCoLf5uKUTwoA",   // CNBC
  "UCrp_UI8XtuYfpiqluWLD7Lw",   // CNBC Television
  "@FinancialTimes",
  "@YahooFinance",
  // Crypto
  "@CoinDesk",
  "UCqK_GSMbpiV8spgD3ZGloSw",   // Coin Bureau
  // World
  "UC16niRr50-MSBwiO3YDb3RA",   // BBC News
  "UCNye-wNBqNL5ZzHSJj3l8Bg",   // Al Jazeera English
  "UCknLrEdhRCp1aegoMqRaCZg",   // DW News
  // Tech and ideas
  "UCBJycsmduvYEL83R_U4JriQ",   // Marques Brownlee
  "UCSHZKyawb77ixDdsGog4iWA",   // Lex Fridman
  "UCAuUUnT6oDeKwE6v1NGQxug",   // TED
  "@TechCrunch",
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/**
 * Which channels to read: the store first, the environment second.
 *
 * Same resolution order as the API keys, for the same reason — what he added
 * from the app takes effect without a redeploy, and an environment variable
 * still works for anyone who prefers one. Store-before-env is what makes
 * "add a channel" actually replace the default set rather than append to it.
 */
async function channels(): Promise<string[]> {
  const saved = await watchedChannels().catch(() => [] as string[]);
  if (saved.length) return saved;
  const env = process.env.MORNING_YT_CHANNELS;
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_CHANNELS;
}

// Resolve a @handle (or channel URL) to its UC… channel id by scraping the page.
// Cached in-process so we only pay the round-trip once per cold start.
const idCache = new Map<string, string>();
async function resolveChannelId(ref: string): Promise<string | null> {
  if (/^UC[\w-]{20,}$/.test(ref)) return ref; // already an id
  if (idCache.has(ref)) return idCache.get(ref)!;
  const handle = ref.replace(/^https?:\/\/(www\.)?youtube\.com\//, "").replace(/^\/?/, "");
  const url = handle.startsWith("@") ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/@${handle}`;
  try {
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"channelId":"(UC[\w-]+)"/) ?? html.match(/channel\/(UC[\w-]+)/);
    if (m?.[1]) { idCache.set(ref, m[1]); return m[1]; }
  } catch {
    /* ignore */
  }
  return null;
}

async function channelVideos(id: string, perChannel: number): Promise<Video[]> {
  try {
    const res = await proxyFetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; SAGE/0.2)" },
    });
    if (!res.ok) return [];
    const doc = parser.parse(await res.text());
    const channelName = String(doc?.feed?.title ?? "YouTube");
    const entries = doc?.feed?.entry ?? [];
    const arr = Array.isArray(entries) ? entries : [entries];
    return arr.slice(0, perChannel).map((e: Record<string, unknown>) => {
      const grp = e["media:group"] as Record<string, unknown> | undefined;
      const thumbO = grp?.["media:thumbnail"] as Record<string, string> | undefined;
      return {
        id: String(e["yt:videoId"] ?? ""),
        title: String(e["title"] ?? ""),
        channel: channelName,
        published: new Date(String(e["published"] ?? Date.now())).getTime(),
        thumb: thumbO?.["@_url"] ?? "",
      };
    }).filter((v: Video) => v.id);
  } catch {
    return [];
  }
}

/** Latest videos across the configured channels, newest first. */
export async function getMorningVideos(perChannel = 2, limit = 24): Promise<Video[]> {
  const ids = (await Promise.all((await channels()).map(resolveChannelId))).filter((x): x is string => !!x);
  /*
   * allSettled, not all. Nineteen channels means nineteen round trips and one
   * of them will be slow or blocked on any given morning; `all` would lose the
   * other eighteen to it.
   */
  const sets = await Promise.allSettled(ids.map((c) => channelVideos(c, perChannel)));
  return sets
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => b.published - a.published)
    .slice(0, limit);
}

/**
 * A still from each live channel, for the television panel's cards.
 *
 * A live stream has no thumbnail you can address without resolving the stream
 * itself, so this takes the newest video on the channel instead. It is the
 * right picture for the job either way: the card is saying "this is Bloomberg",
 * not "this is the current frame", and a channel's latest upload looks like the
 * channel.
 */
export async function channelStills(ids: string[]): Promise<Record<string, string>> {
  const sets = await Promise.allSettled(ids.map(async (id) => [id, (await channelVideos(id, 1))[0]?.thumb ?? ""] as const));
  const out: Record<string, string> = {};
  for (const r of sets) {
    if (r.status === "fulfilled" && r.value[1]) out[r.value[0]] = r.value[1];
  }
  return out;
}

/* ── what is on right now ──────────────────────────────────────────────────
 *
 * `/embed/live_stream?channel=UC…` is the no-key way to embed a channel's
 * current broadcast, and it has one failure mode that matters: when the
 * channel is NOT live it renders YouTube's own error inside the frame —
 * "This video is unavailable", or a playback-ID error — and the panel sits
 * there showing a grey box. Three screens, two of them grey, which is what
 * Gyaan was looking at.
 *
 * So the panel stops guessing. This resolves what is actually playable for a
 * channel and says which it is:
 *
 *   · With YOUTUBE_API_KEY set, the Data API answers definitively whether
 *     the channel has a live broadcast and what its video id is. A search
 *     costs 100 of the 10,000 free daily units, so the result is cached for
 *     fifteen minutes — three screens refreshed every fifteen minutes is
 *     about 290 units a day.
 *   · Without a key there is no reliable way to ask. Scraping the /live page
 *     was tried and rejected: YouTube serves a different document to a
 *     datacentre IP than to a browser, and the live markers are simply not
 *     in it, so the scrape reports "not live" for channels that plainly are.
 *     Guessing wrong in that direction is worse than not guessing.
 *
 * Either way the channel's newest upload comes back as `fallback`, so a
 * screen with nothing live on it can play something real and say so rather
 * than showing an error page.
 */
export interface Airing {
  /** The live broadcast's video id, when one is known to exist. */
  live: string | null;
  /** The newest upload, for a screen with nothing live on it. */
  fallback: { id: string; title: string } | null;
  /** How `live` was determined, so the UI can be honest about it. */
  via: "api" | "unknown";
}

const airCache = new Map<string, { at: number; value: Airing }>();
const AIR_TTL = 15 * 60_000;

async function liveViaApi(id: string, key: string): Promise<string | null> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${id}`
    + `&eventType=live&type=video&maxResults=1&key=${key}`;
  const res = await proxyFetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const j = (await res.json()) as { items?: { id?: { videoId?: string } }[] };
  return j.items?.[0]?.id?.videoId ?? null;
}

export async function airing(id: string): Promise<Airing> {
  const hit = airCache.get(id);
  if (hit && Date.now() - hit.at < AIR_TTL) return hit.value;

  const key = process.env.YOUTUBE_API_KEY?.trim();
  const [liveR, latestR] = await Promise.allSettled([
    key ? liveViaApi(id, key) : Promise.resolve(null),
    channelVideos(id, 1),
  ]);

  const latest = latestR.status === "fulfilled" ? latestR.value[0] : undefined;
  const value: Airing = {
    live: liveR.status === "fulfilled" ? liveR.value : null,
    fallback: latest ? { id: latest.id, title: latest.title } : null,
    via: key ? "api" : "unknown",
  };
  airCache.set(id, { at: Date.now(), value });
  return value;
}

export async function airingFor(ids: string[]): Promise<Record<string, Airing>> {
  const out: Record<string, Airing> = {};
  const rs = await Promise.allSettled(ids.map(async (id) => [id, await airing(id)] as const));
  for (const r of rs) if (r.status === "fulfilled") out[r.value[0]] = r.value[1];
  return out;
}
