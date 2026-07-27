import { XMLParser } from "fast-xml-parser";
import { proxyFetch } from "@/infrastructure/http/fetch";

export interface Headline {
  source: string;
  title: string;
  link: string;
  published: number;
  image?: string;
}

/** Curated RSS sources (all public feeds). LinkedIn/HEY have no open RSS — see integrations. */
const FEEDS: { source: string; url: string }[] = [
  { source: "MINT", url: "https://www.livemint.com/rss/news" },
  { source: "COINDESK", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "MIT TR", url: "https://www.technologyreview.com/feed/" },
  { source: "TED", url: "https://www.ted.com/feeds/talks.rss" },
  { source: "FT", url: "https://www.ft.com/rss/home" },
];

/** Named sources for the Morning Block, in the order Gyaan reads them.
 *  `site` is the domain used for the Google News fallback when a publisher's
 *  own RSS is blocked (Cloudflare) or empty. */
export const NEWS_SOURCES: Record<string, { source: string; url: string; site: string }> = {
  ft: { source: "Financial Times", url: "https://www.ft.com/rss/home", site: "ft.com" },
  mint: { source: "Mint", url: "https://www.livemint.com/rss/news", site: "livemint.com" },
  finexpress: { source: "Financial Express", url: "https://www.financialexpress.com/feed/", site: "financialexpress.com" },
  coindesk: { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", site: "coindesk.com" },
  mittr: { source: "MIT Tech Review", url: "https://www.technologyreview.com/feed/", site: "technologyreview.com" },
};

/** Google News RSS scoped to a publisher — reliable when the direct feed is
 *  blocked. Titles arrive as "Headline - Publisher"; strip the suffix. */
async function googleNewsFeed(source: string, site: string, limit: number): Promise<Headline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${site} when:2d`)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const items = await fetchFeed(source, url, limit);
  return items.map((h) => ({ ...h, title: h.title.replace(/\s+-\s+[^-]+$/, "").trim() }));
}

/** Headlines for a single named source (Morning Block reader). Tries the
 *  publisher's own RSS first, then falls back to Google News so a blocked feed
 *  (e.g. Financial Express) still returns headlines. */
export async function getSourceHeadlines(key: string, limit = 6): Promise<Headline[]> {
  const s = NEWS_SOURCES[key];
  if (!s) return [];
  const direct = await fetchFeed(s.source, s.url, limit);
  if (direct.length >= 2) return direct;
  const fallback = await googleNewsFeed(s.source, s.site, limit);
  return fallback.length ? fallback : direct;
}

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

async function fetchFeed(source: string, url: string, limit = 4): Promise<Headline[]> {
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
    return arr.slice(0, limit).map((it) => ({
      source,
      title: text(it.title).trim(),
      link: href(it.link),
      published: new Date(it.pubDate ?? it.published ?? Date.now()).getTime(),
      image: imageOf(it as Record<string, unknown>),
    })).filter((h) => h.title);
  } catch {
    return [];
  }
}

/** Pull a thumbnail from the many places RSS hides one. */
function imageOf(it: Record<string, unknown>): string | undefined {
  const attrUrl = (v: unknown): string | undefined => {
    const o = Array.isArray(v) ? v[0] : v;
    const u = o && typeof o === "object" ? (o as Record<string, string>)["@_url"] : undefined;
    return u || undefined;
  };
  const media = attrUrl(it["media:content"]) ?? attrUrl(it["media:thumbnail"]);
  if (media) return media;
  const grp = it["media:group"] as Record<string, unknown> | undefined;
  if (grp) { const g = attrUrl(grp["media:content"]) ?? attrUrl(grp["media:thumbnail"]); if (g) return g; }
  const enc = it["enclosure"];
  const encO = Array.isArray(enc) ? enc[0] : enc;
  if (encO && typeof encO === "object") {
    const o = encO as Record<string, string>;
    if (/image/i.test(o["@_type"] ?? "") || /\.(jpe?g|png|webp)/i.test(o["@_url"] ?? "")) return o["@_url"];
  }
  // first <img> in description / content:encoded
  const html = text(it["content:encoded"]) || text(it["description"]);
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m?.[1];
}

/** Aggregate latest headlines across all sources, newest first. */
export async function getNews(limit = 12): Promise<Headline[]> {
  const results = await Promise.all(FEEDS.map((f) => fetchFeed(f.source, f.url)));
  return results.flat().sort((a, b) => b.published - a.published).slice(0, limit);
}
