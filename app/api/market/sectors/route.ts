import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const revalidate = 900;

// Indian sector indices + US sector ETFs — all priced by Yahoo, no key needed.
const SECTORS: { symbol: string; label: string; region: "IN" | "US" }[] = [
  { symbol: "^CNXIT", label: "IT", region: "IN" },
  { symbol: "^NSEBANK", label: "Bank", region: "IN" },
  { symbol: "^CNXAUTO", label: "Auto", region: "IN" },
  { symbol: "^CNXPHARMA", label: "Pharma", region: "IN" },
  { symbol: "^CNXFMCG", label: "FMCG", region: "IN" },
  { symbol: "^CNXMETAL", label: "Metal", region: "IN" },
  { symbol: "^CNXENERGY", label: "Energy", region: "IN" },
  { symbol: "^CNXREALTY", label: "Realty", region: "IN" },
  { symbol: "XLK", label: "Tech", region: "US" },
  { symbol: "XLF", label: "Financials", region: "US" },
  { symbol: "XLE", label: "Energy", region: "US" },
  { symbol: "XLV", label: "Health", region: "US" },
  { symbol: "XLY", label: "Consumer", region: "US" },
  { symbol: "XLI", label: "Industrials", region: "US" },
];

interface SectorTile { symbol: string; label: string; region: "IN" | "US"; changePct: number | null; price: number | null }

async function tile(s: (typeof SECTORS)[number]): Promise<SectorTile> {
  try {
    const res = await proxyFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.symbol)}?interval=1d&range=5d`,
      { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number } }[] } };
    const m = j.chart?.result?.[0]?.meta;
    const price = m?.regularMarketPrice ?? null;
    const prev = m?.chartPreviousClose ?? null;
    return { ...s, price, changePct: price != null && prev ? ((price - prev) / prev) * 100 : null };
  } catch {
    return { ...s, price: null, changePct: null };
  }
}

/** Sector heatmap — which parts of the market are actually working today. */
export async function GET() {
  const tiles = await Promise.all(SECTORS.map(tile));
  const live = tiles.filter((t) => t.changePct != null);
  const sorted = [...live].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  return NextResponse.json({
    ok: true,
    data: {
      sectors: tiles,
      leaders: sorted.slice(0, 3),
      laggards: sorted.slice(-3).reverse(),
      breadth: live.length ? (live.filter((t) => (t.changePct ?? 0) > 0).length / live.length) * 100 : null,
    },
  });
}
