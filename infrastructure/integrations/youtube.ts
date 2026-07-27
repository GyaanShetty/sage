import { XMLParser } from "fast-xml-parser";
import { proxyFetch } from "@/infrastructure/http/fetch";

export interface Video {
  id: string;
  title: string;
  channel: string;
  published: number;
  thumb: string;
}

// Gyaan's channels — news/finance/crypto. Handles (@name) or raw UC… ids both
// work; override with MORNING_YT_CHANNELS (comma-separated).
const DEFAULT_CHANNELS = ["@FinancialTimes", "@CoinDesk", "@Bloomberg", "@CNBC", "@mkbhd"];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function channels(): string[] {
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
export async function getMorningVideos(perChannel = 2): Promise<Video[]> {
  const ids = (await Promise.all(channels().map(resolveChannelId))).filter((x): x is string => !!x);
  const sets = await Promise.all(ids.map((c) => channelVideos(c, perChannel)));
  return sets.flat().sort((a, b) => b.published - a.published).slice(0, 6);
}
