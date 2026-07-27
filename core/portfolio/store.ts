import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { getMarkets } from "@/infrastructure/markets";

export interface Holding {
  id: string;
  symbol: string;      // BTC, ETH, AAPL, ^NSEI…
  kind: "crypto" | "stock";
  qty: number;
  avgCost: number;     // per unit, in the price currency
  thesis?: string | null;
}

export interface Position extends Holding {
  price: number | null;
  value: number | null;
  cost: number;
  pnl: number | null;
  pnlPct: number | null;
  change24h: number | null;
}

const H_TYPE = "portfolio.holding";

export async function listHoldings(): Promise<Holding[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", H_TYPE)
    .order("createdAt", { ascending: true }).limit(200);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Holding, "id">) }));
}

export async function upsertHolding(h: Partial<Holding> & { id?: string }): Promise<string> {
  if (h.id) {
    const { data } = await db.from("Event").select("payload").eq("id", h.id).maybeSingle();
    const merged = { ...(data?.payload as object), ...h };
    delete (merged as { id?: string }).id;
    await db.from("Event").update({ payload: merged }).eq("id", h.id);
    return h.id;
  }
  const id = crypto.randomUUID();
  const payload = {
    symbol: (h.symbol ?? "").toUpperCase(), kind: h.kind ?? "crypto",
    qty: Number(h.qty) || 0, avgCost: Number(h.avgCost) || 0, thesis: h.thesis ?? null,
  };
  await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: H_TYPE, payload });
  return id;
}

export async function deleteHolding(id: string): Promise<void> {
  await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
}

/** Price a stock symbol via the internal quotes endpoint. */
async function stockPrices(symbols: string[], origin: string, cookie: string): Promise<Record<string, { price: number; changePct: number }>> {
  if (!symbols.length) return {};
  try {
    const j = await fetch(`${origin}/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, { headers: { cookie } })
      .then((r) => r.json());
    const out: Record<string, { price: number; changePct: number }> = {};
    for (const q of (j.data ?? []) as { symbol: string; price: number; changePct: number }[]) out[q.symbol.toUpperCase()] = { price: q.price, changePct: q.changePct };
    return out;
  } catch { return {}; }
}

/** Live positions with P&L. `origin`/`cookie` let us reach the quotes route for stocks. */
export async function getPositions(origin: string, cookie: string): Promise<{ positions: Position[]; totals: { value: number; cost: number; pnl: number; pnlPct: number } }> {
  const holdings = await listHoldings();
  const coins = await getMarkets().catch(() => null);
  const coinMap: Record<string, { price: number; change24h: number }> = {};
  for (const c of coins ?? []) coinMap[c.symbol.toUpperCase()] = { price: c.price, change24h: c.change24h };

  const stockSyms = holdings.filter((h) => h.kind === "stock").map((h) => h.symbol);
  const stocks = await stockPrices(stockSyms, origin, cookie);

  const positions: Position[] = holdings.map((h) => {
    const q = h.kind === "crypto" ? coinMap[h.symbol.toUpperCase()] : undefined;
    const s = h.kind === "stock" ? stocks[h.symbol.toUpperCase()] : undefined;
    const price = q?.price ?? s?.price ?? null;
    const change24h = q?.change24h ?? s?.changePct ?? null;
    const cost = h.qty * h.avgCost;
    const value = price != null ? h.qty * price : null;
    const pnl = value != null ? value - cost : null;
    const pnlPct = pnl != null && cost > 0 ? (pnl / cost) * 100 : null;
    return { ...h, price, value, cost, pnl, pnlPct, change24h };
  });

  const value = positions.reduce((a, p) => a + (p.value ?? 0), 0);
  const cost = positions.reduce((a, p) => a + p.cost, 0);
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  return { positions, totals: { value, cost, pnl, pnlPct } };
}
