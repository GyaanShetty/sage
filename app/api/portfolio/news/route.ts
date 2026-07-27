import { NextResponse } from "next/server";
import { listHoldings } from "@/core/portfolio/store";
import { getNews } from "@/infrastructure/news";

export const revalidate = 600;

// Map tickers to the words that appear in headlines.
const TERMS: Record<string, string[]> = {
  BTC: ["btc", "bitcoin"], ETH: ["eth", "ethereum", "ether"], SOL: ["sol", "solana"],
  XRP: ["xrp", "ripple"], DOGE: ["doge", "dogecoin"], ADA: ["ada", "cardano"],
  BNB: ["bnb", "binance"], LINK: ["chainlink"], AVAX: ["avalanche"], MATIC: ["polygon", "matic"],
  AAPL: ["apple"], NVDA: ["nvidia"], TSLA: ["tesla"], MSFT: ["microsoft"], GOOGL: ["google", "alphabet"],
  AMZN: ["amazon"], META: ["meta", "facebook"],
};

/** Headlines relevant to the user's holdings — the news↔position interlink. */
export async function GET() {
  const holdings = await listHoldings();
  if (!holdings.length) return NextResponse.json({ ok: true, data: [] });
  const news = await getNews(40).catch(() => []);

  const out: { symbol: string; title: string; link: string; source: string }[] = [];
  const seen = new Set<string>();
  for (const h of holdings) {
    const terms = TERMS[h.symbol.toUpperCase()] ?? [h.symbol.toLowerCase()];
    for (const n of news) {
      const t = n.title.toLowerCase();
      if (terms.some((term) => t.includes(term))) {
        const key = `${h.symbol}:${n.link}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ symbol: h.symbol.toUpperCase(), title: n.title, link: n.link, source: n.source });
      }
    }
  }
  return NextResponse.json({ ok: true, data: out.slice(0, 20) });
}
