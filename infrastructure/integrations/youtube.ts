import { XMLParser } from "fast-xml-parser";
import { proxyFetch } from "@/infrastructure/http/fetch";

export interface Video {
  id: string;
  title: string;
  channel: string;
  published: number;
  thumb: string;
}

// Default channels aligned to Gyaan's interests (tech / startups / finance).
// Override with MORNING_YT_CHANNELS (comma-separated channel IDs).
const DEFAULT_CHANNELS = [
  "UCsBjURrPoezykLs9EqgamOA", // Fireship (coding)
  "UCcefcZRL2oaA_uBNeo5UOWg", // Y Combinator (startups)
  "UCoUxsWakJucWg46KW5RsvPw", // Financial Times
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function channels(): string[] {
  const env = process.env.MORNING_YT_CHANNELS;
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_CHANNELS;
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
  const sets = await Promise.all(channels().map((c) => channelVideos(c, perChannel)));
  return sets.flat().sort((a, b) => b.published - a.published).slice(0, 6);
}
