import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Papers, from the source.
 *
 * The research agent reads the web, which for a technical question means blog
 * posts about papers rather than the papers. arXiv's API is free, needs no
 * key, no account and no rate-limit negotiation, and returns the abstract —
 * which is the part that decides whether the paper is worth opening.
 *
 * Deliberately no key, no dependency: the response is Atom XML, and the four
 * fields an abstract listing needs are extractable without pulling in a parser
 * for a format used in exactly one place.
 */

export interface Paper {
  id: string;              // arXiv id, e.g. "2401.01234v1"
  title: string;
  authors: string[];
  summary: string;
  published: string;       // ISO
  updated: string;
  categories: string[];
  /** Abstract page — the human one, not the API. */
  url: string;
  pdfUrl: string;
  /** Journal or conference, when the authors have recorded one. */
  comment?: string;
}

const API = "http://export.arxiv.org/api/query";

/** Everything between <tag ...> and </tag>, first match. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1].trim()) : null;
}

function tagAll(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decode(m[1].trim()));
  return out;
}

function attrAll(xml: string, name: string, attr: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b[^>]*\\b${attr}="([^"]*)"`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decode(m[1]));
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    // Abstracts arrive hard-wrapped at ~80 columns; the line breaks are an
    // artefact of the format, not the author's paragraphing.
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function parseEntry(entry: string): Paper | null {
  const title = tag(entry, "title");
  const idUrl = tag(entry, "id");
  if (!title || !idUrl) return null;

  const id = idUrl.split("/abs/")[1] ?? idUrl;
  return {
    id,
    title,
    authors: tagAll(entry, "author").map((a) => tag(a, "name") ?? a).filter(Boolean),
    summary: tag(entry, "summary") ?? "",
    published: tag(entry, "published") ?? "",
    updated: tag(entry, "updated") ?? "",
    categories: attrAll(entry, "category", "term"),
    url: idUrl.replace("http://", "https://"),
    pdfUrl: `https://arxiv.org/pdf/${id}`,
    ...(tag(entry, "arxiv:comment") ? { comment: tag(entry, "arxiv:comment")! } : {}),
  };
}

export type SortBy = "relevance" | "recent";

/**
 * Search arXiv.
 *
 * A bare query goes to `all:`, which searches title, abstract and authors
 * together — the behaviour someone typing a topic expects. A query that
 * already names a field (`au:`, `ti:`, `cat:`) is passed through untouched, so
 * the syntax remains available to anyone who knows it.
 */
export async function searchPapers(
  query: string,
  { limit = 10, sortBy = "relevance" }: { limit?: number; sortBy?: SortBy } = {},
): Promise<Paper[] | null> {
  const clean = query.trim();
  if (!clean) return [];

  const fielded = /\b(all|ti|au|abs|cat|jr|co|rn|id):/i.test(clean);
  const search = fielded ? clean : `all:${clean}`;

  const params = new URLSearchParams({
    search_query: search,
    start: "0",
    max_results: String(Math.min(50, Math.max(1, limit))),
    sortBy: sortBy === "recent" ? "submittedDate" : "relevance",
    sortOrder: "descending",
  });

  try {
    const res = await proxyFetch(`${API}?${params}`, {
      headers: { accept: "application/atom+xml", "user-agent": "SAGE" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const xml = await res.text();

    const entries = xml.split("<entry>").slice(1).map((e) => e.split("</entry>")[0]);
    return entries.map(parseEntry).filter((p): p is Paper => p !== null);
  } catch {
    return null;
  }
}

/** One paper by its arXiv id, for saving or citing. */
export async function getPaper(id: string): Promise<Paper | null> {
  const clean = id.trim().replace(/^arxiv:/i, "").replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, "");
  if (!clean) return null;
  const papers = await searchPapers(`id:${clean}`, { limit: 1 });
  return papers?.[0] ?? null;
}

/** A citation line for a brief or a note. */
export function cite(p: Paper): string {
  const year = p.published.slice(0, 4);
  const authors =
    p.authors.length === 0 ? "" :
    p.authors.length <= 2 ? p.authors.join(" & ") :
    `${p.authors[0]} et al.`;
  return `${authors}${year ? ` (${year})` : ""}. ${p.title}. arXiv:${p.id}`;
}
