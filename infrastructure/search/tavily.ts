import { proxyFetch } from "@/infrastructure/http/fetch";

export interface WebResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Tavily web search (free tier: ~1000 credits/mo at tavily.com).
 * Returns null when no key is configured so callers can degrade gracefully.
 */
export async function webSearch(query: string, maxResults = 5): Promise<WebResult[] | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  const res = await proxyFetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: maxResults, include_answer: false }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const json = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  return (json.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content }));
}
