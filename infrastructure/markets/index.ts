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
