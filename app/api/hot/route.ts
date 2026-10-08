import { NextResponse } from "next/server";
import { getAllSourceHeadlines, type Headline } from "@/infrastructure/news";

/**
 * What is actually hot, derived rather than fetched.
 *
 * GDELT publishes a trending API and it is the obvious thing to reach for;
 * it is also rate-limited to one request every five seconds and its timeline
 * endpoint returned an empty series for every query I tried. So this computes
 * the answer from the eight feeds SAGE already pulls, which has two
 * advantages over any trending API: it is *his* sources rather than the
 * world's, and it costs nothing new.
 *
 * The signal is BREADTH, not volume. A story mentioned five times by one
 * outlet is that outlet having a position; the same name in the FT, Mint and
 * CoinDesk is a thing that is happening. So topics are ranked by how many
 * distinct publishers carry them, and a topic only one outlet mentions is not
 * a topic.
 */

export interface Topic {
  term: string;
  /** How many distinct publishers carry it. */
  sources: number;
  mentions: number;
  stories: { title: string; link: string; source: string; published: number }[];
}

/*
 * Words that capitalise for grammatical reasons rather than because they name
 * anything — sentence starts, days, and the vocabulary of headline writing.
 * Without this the top "topic" every morning is "The".
 */
const STOP = new Set([
  "the","a","an","and","or","but","for","nor","so","yet","of","to","in","on","at","by","from","with",
  "as","is","are","was","were","be","been","will","would","can","could","may","might","must","should",
  "this","that","these","those","it","its","his","her","their","our","your","my",
  "new","news","says","said","after","before","how","why","what","when","where","who","which",
  "live","updates","update","report","reports","first","last","next","more","most","top","best",
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
  "january","february","march","april","may","june","july","august","september","october","november","december",
  "india","indian","us","u.s.","uk","exclusive","opinion","analysis","watch","read","here","amid","over",
]);

/** Capitalised runs of one to three words — names, places, companies, tickers. */
function terms(title: string): string[] {
  const out: string[] = [];
  // Strip the leading clause marker headlines love ("LIVE Updates: …").
  const clean = title.replace(/^[A-Z\s]{4,}:\s*/, "");
  const re = /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const phrase = m[1].trim();
    if (phrase.length < 3) continue;
    const words = phrase.split(/\s+/);
    // A single capitalised word that is a stopword is sentence case, not a name.
    if (words.length === 1 && STOP.has(words[0].toLowerCase())) continue;
    // Drop a phrase that is entirely stopwords however long it is.
    if (words.every((w) => STOP.has(w.toLowerCase()))) continue;
    out.push(phrase);
  }
  return out;
}

export async function GET() {
  let heads: Headline[] = [];
  try {
    heads = await getAllSourceHeadlines(10);
  } catch {
    return NextResponse.json({ ok: false, error: "The wire is unreachable." }, { status: 502 });
  }
  if (!heads.length) return NextResponse.json({ ok: true, data: { topics: [], of: 0 } });

  const byTerm = new Map<string, { sources: Set<string>; mentions: number; stories: Headline[] }>();
  for (const h of heads) {
    // One credit per term per headline, or a headline repeating a name three
    // times outranks three headlines about it.
    for (const t of new Set(terms(h.title))) {
      const key = t.toLowerCase();
      const e = byTerm.get(key) ?? { sources: new Set<string>(), mentions: 0, stories: [] };
      e.sources.add(h.source);
      e.mentions += 1;
      if (e.stories.length < 4) e.stories.push(h);
      byTerm.set(key, e);
    }
  }

  const topics: Topic[] = [...byTerm.entries()]
    .filter(([, e]) => e.sources.size >= 2)        // breadth, not volume
    .map(([key, e]) => ({
      // Show it the way the headlines spell it, not lowercased.
      term: e.stories[0].title.match(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))?.[0] ?? key,
      sources: e.sources.size,
      mentions: e.mentions,
      stories: e.stories.map((s) => ({ title: s.title, link: s.link, source: s.source, published: s.published })),
    }))
    .sort((a, b) => b.sources - a.sources || b.mentions - a.mentions)
    .slice(0, 10);

  return NextResponse.json(
    { ok: true, data: { topics, of: heads.length } },
    { headers: { "cache-control": "public, max-age=600" } },
  );
}
