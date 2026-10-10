import { NextResponse } from "next/server";
import { getAllSourceHeadlines } from "@/infrastructure/news";

/**
 * Today's stories that came with a picture.
 *
 * Every RSS item SAGE reads already carries an `image` — the parser digs it
 * out of media:content, enclosures and the first <img> in the description —
 * and until now exactly one of them was ever shown, as a 78px thumbnail
 * beside the morning wire's lead. Several hundred photographs a day were
 * being fetched, parsed and thrown away.
 *
 * This is them. Newest first, de-duplicated on the image URL as well as the
 * headline, because syndicated copy reaches three outlets with three
 * headlines and one wire photograph.
 */
export const revalidate = 300;

export async function GET() {
  const all = await getAllSourceHeadlines(12);
  const seen = new Set<string>();
  const shots = [];
  for (const h of all) {
    if (!h.image) continue;
    /* The query string on a CDN URL is usually a crop or a cache-buster, so
       two "different" URLs are routinely the same photograph. */
    const key = h.image.split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    shots.push({ title: h.title, link: h.link, source: h.source, published: h.published, image: h.image });
    if (shots.length >= 24) break;
  }
  return NextResponse.json({ ok: true, data: { shots, of: all.length } });
}
