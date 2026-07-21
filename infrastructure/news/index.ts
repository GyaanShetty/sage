import { XMLParser } from "fast-xml-parser";
import { proxyFetch } from "@/infrastructure/http/fetch";

export interface Headline {
  source: string;
  title: string;
  link: string;
  published: number;
}

/** Curated RSS sources (all public feeds). LinkedIn/HEY have no open RSS — see integrations. */
const FEEDS: { source: string; url: string }[] = [
  { source: "MINT", url: "https://www.livemint.com/rss/news" },
  { source: "COINDESK", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "MIT TR", url: "https://www.technologyreview.com/feed/" },
  { source: "TED", url: "https://www.ted.com/feeds/talks.rss" },
  { source: "FT", url: "https://www.ft.com/rss/home" },
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

interface RssItem { title?: string | { "#text"?: string }; link?: string | { "@_href"?: string }; pubDate?: string; published?: string }

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) return String((v as { "#text": string })["#text"] ?? "");
  return "";
}
function href(link: unknown): string {
  if (typeof link === "string") return link;
  if (Array.isArray(link)) return href(link.find((l) => (l as { "@_rel"?: string })?.["@_rel"] !== "self") ?? link[0]);
  if (link && typeof link === "object" && "@_href" in link) return String((link as { "@_href": string })["@_href"] ?? "");
  return "";
}

async function fetchFeed(source: string, url: string): Promise<Headline[]> {
  try {
    const res = await proxyFetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; SAGE/0.2)", accept: "application/rss+xml, application/xml, text/xml" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const doc = parser.parse(xml);
    const items: RssItem[] = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
    const arr = Array.isArray(items) ? items : [items];
    return arr.slice(0, 4).map((it) => ({
      source,
      title: text(it.title).trim(),
      link: href(it.link),
      published: new Date(it.pubDate ?? it.published ?? Date.now()).getTime(),
    })).filter((h) => h.title);
  } catch {
    return [];
  }
}

/** Aggregate latest headlines across all sources, newest first. */
export async function getNews(limit = 12): Promise<Headline[]> {
  const results = await Promise.all(FEEDS.map((f) => fetchFeed(f.source, f.url)));
  return results.flat().sort((a, b) => b.published - a.published).slice(0, limit);
}
