import { proxyFetch } from "@/infrastructure/http/fetch";

export interface Coin {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  spark: number[];
}

const IDS = ["bitcoin", "ethereum", "solana", "chainlink"];

/** Live crypto prices + 7d sparklines from CoinGecko (free, no key). */
export async function getMarkets(): Promise<Coin[] | null> {
  try {
    const url =
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${IDS.join(",")}` +
      `&order=market_cap_desc&sparkline=true&price_change_percentage=24h`;
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(9000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      symbol: string;
      name: string;
      current_price: number;
      price_change_percentage_24h: number;
      sparkline_in_7d: { price: number[] };
    }[];
    return data.map((c) => ({
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price: c.current_price,
      change24h: c.price_change_percentage_24h ?? 0,
      // downsample sparkline to ~28 points
      spark: (c.sparkline_in_7d?.price ?? []).filter((_, i) => i % 6 === 0).slice(-28),
    }));
  } catch {
    return null;
  }
}

export interface Stock { symbol: string; price: number; change: number }

/**
 * Stock quotes via Alpha Vantage (free tier: 25 req/day — keep the list small,
 * cache aggressively upstream). Symbols default to a few majors + Indian .BSE.
 */
export async function getStocks(): Promise<Stock[] | null> {
  const key = process.env.ALPHAVANTAGE_KEY;
  if (!key) return null;
  const symbols = (process.env.SAGE_STOCKS ?? "RELIANCE.BSE,TCS.BSE,NVDA").split(",").map((s) => s.trim());
  const out: Stock[] = [];
  for (const symbol of symbols) {
    try {
      const res = await proxyFetch(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`,
        { signal: AbortSignal.timeout(9000) },
      );
      if (!res.ok) continue;
      const j = (await res.json()) as { "Global Quote"?: Record<string, string> };
      const q = j["Global Quote"];
      if (!q || !q["05. price"]) continue;
      out.push({
        symbol: symbol.replace(".BSE", ""),
        price: parseFloat(q["05. price"]),
        change: parseFloat((q["10. change percent"] ?? "0").replace("%", "")),
      });
    } catch {
      /* skip */
    }
  }
  return out.length ? out : null;
}
