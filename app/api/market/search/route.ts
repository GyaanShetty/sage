import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const dynamic = "force-dynamic";

export interface SymbolHit {
  symbol: string;
  name: string;
  exchange: string;
  kind: "crypto" | "stock";
}

// Yahoo Finance symbol search — free, no key. Covers US, NSE/BSE (.NS/.BO),
// indices, ETFs and crypto pairs. Cached briefly to stay under any rate limit.
const cache = new Map<string, { at: number; hits: SymbolHit[] }>();
const TTL = 5 * 60 * 1000;

interface YQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  quoteType?: string;
  isYahooFinance?: boolean;
}

/** Symbol search for the portfolio's "add holding" bar. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json({ ok: true, data: [] });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ ok: true, data: hit.hits });

  try {
    const res = await proxyFetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`,
      { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { quotes?: YQuote[] };
    const hits: SymbolHit[] = (j.quotes ?? [])
      .filter((x) => x.isYahooFinance !== false && x.symbol)
      .map((x) => {
        const type = (x.quoteType ?? "").toUpperCase();
        const kind: "crypto" | "stock" = type === "CRYPTOCURRENCY" ? "crypto" : "stock";
        return {
          symbol: x.symbol!,
          name: x.longname ?? x.shortname ?? x.symbol!,
          exchange: x.exchDisp ?? "",
          kind,
        };
      })
      .slice(0, 8);
    cache.set(key, { at: Date.now(), hits });
    return NextResponse.json({ ok: true, data: hits });
  } catch {
    return NextResponse.json({ ok: true, data: [] });
  }
}
