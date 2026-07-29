import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export type TradeSide = "buy" | "sell";

export interface Trade {
  id: string;
  symbol: string;
  kind: "crypto" | "stock";
  side: TradeSide;
  qty: number;
  price: number;      // per unit, in the position's price currency
  fees: number;
  date: string;       // ISO
  note?: string | null;
}

export interface Income {
  id: string;
  symbol: string;
  kind: "dividend" | "staking" | "interest";
  amount: number;
  date: string;
  note?: string | null;
}

const T_TYPE = "portfolio.trade";
const I_TYPE = "portfolio.income";

export async function listTrades(): Promise<Trade[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", T_TYPE)
    .order("createdAt", { ascending: false }).limit(500);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Trade, "id">) }));
}

export async function addTrade(t: Partial<Trade>): Promise<string> {
  const id = crypto.randomUUID();
  const payload = {
    symbol: (t.symbol ?? "").toUpperCase(),
    kind: t.kind === "stock" ? "stock" : "crypto",
    side: t.side === "sell" ? "sell" : "buy",
    qty: Math.abs(Number(t.qty) || 0),
    price: Number(t.price) || 0,
    fees: Number(t.fees) || 0,
    date: t.date ?? new Date().toISOString(),
    note: t.note ?? null,
  };
  await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: T_TYPE, payload });
  return id;
}

export async function deleteTrade(id: string): Promise<void> {
  await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
}

export async function listIncome(): Promise<Income[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", I_TYPE)
    .order("createdAt", { ascending: false }).limit(500);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Income, "id">) }));
}

export async function addIncome(i: Partial<Income>): Promise<string> {
  const id = crypto.randomUUID();
  const payload = {
    symbol: (i.symbol ?? "").toUpperCase(),
    kind: (["dividend", "staking", "interest"] as const).includes(i.kind as never) ? i.kind : "dividend",
    amount: Number(i.amount) || 0,
    date: i.date ?? new Date().toISOString(),
    note: i.note ?? null,
  };
  await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: I_TYPE, payload });
  return id;
}

export async function deleteIncome(id: string): Promise<void> {
  await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
}

export interface RealizedLot {
  symbol: string;
  kind: "crypto" | "stock";
  qty: number;
  proceeds: number;
  costBasis: number;
  pnl: number;
  openedAt: string | null;
  closedAt: string;
  /** Indian tax rule of thumb: equity >12m and crypto/other >36m is long-term. */
  term: "short" | "long";
}

/**
 * Walk the trade log per symbol in FIFO order, matching sells against open buy
 * lots. Produces realized P&L with holding periods for the capital-gains report.
 */
export function realizeFifo(trades: Trade[]): RealizedLot[] {
  const bySymbol = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = `${t.kind}:${t.symbol.toUpperCase()}`;
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key)!.push(t);
  }

  const out: RealizedLot[] = [];
  for (const [key, list] of bySymbol) {
    const [kind, symbol] = key.split(":") as ["crypto" | "stock", string];
    const chron = [...list].sort((a, b) => +new Date(a.date) - +new Date(b.date));
    // open buy lots, FIFO
    const lots: { qty: number; price: number; date: string }[] = [];

    for (const t of chron) {
      if (t.side === "buy") {
        // spread fees into the cost basis
        const unitCost = t.qty > 0 ? t.price + t.fees / t.qty : t.price;
        lots.push({ qty: t.qty, price: unitCost, date: t.date });
        continue;
      }
      // sell: consume oldest lots first
      let remaining = t.qty;
      const netUnitProceeds = t.qty > 0 ? t.price - t.fees / t.qty : t.price;
      while (remaining > 0.0000001 && lots.length) {
        const lot = lots[0];
        const take = Math.min(lot.qty, remaining);
        const proceeds = take * netUnitProceeds;
        const costBasis = take * lot.price;
        const heldDays = (+new Date(t.date) - +new Date(lot.date)) / 86400000;
        const longThreshold = kind === "stock" ? 365 : 1095;
        out.push({
          symbol, kind, qty: take, proceeds, costBasis,
          pnl: proceeds - costBasis,
          openedAt: lot.date, closedAt: t.date,
          term: heldDays >= longThreshold ? "long" : "short",
        });
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 0.0000001) lots.shift();
      }
      if (remaining > 0.0000001) {
        // sold more than we have a record of buying — treat basis as zero
        out.push({
          symbol, kind, qty: remaining,
          proceeds: remaining * netUnitProceeds, costBasis: 0,
          pnl: remaining * netUnitProceeds,
          openedAt: null, closedAt: t.date, term: "short",
        });
      }
    }
  }
  return out.sort((a, b) => +new Date(b.closedAt) - +new Date(a.closedAt));
}

/** Indian financial year (Apr 1 – Mar 31) containing a date, e.g. "2025-26". */
export function financialYear(d: Date | string): string {
  const dt = new Date(d);
  const y = dt.getUTCFullYear();
  const startYear = dt.getUTCMonth() >= 3 ? y : y - 1; // month 3 = April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export interface TaxReport {
  fy: string;
  shortTerm: { proceeds: number; costBasis: number; pnl: number; count: number };
  longTerm: { proceeds: number; costBasis: number; pnl: number; count: number };
  income: number;
  lots: RealizedLot[];
}

/** Capital-gains summary for one Indian FY, split short/long term. */
export function taxReport(lots: RealizedLot[], income: Income[], fy: string): TaxReport {
  const inFy = lots.filter((l) => financialYear(l.closedAt) === fy);
  const agg = (term: "short" | "long") => {
    const rows = inFy.filter((l) => l.term === term);
    return {
      proceeds: rows.reduce((a, r) => a + r.proceeds, 0),
      costBasis: rows.reduce((a, r) => a + r.costBasis, 0),
      pnl: rows.reduce((a, r) => a + r.pnl, 0),
      count: rows.length,
    };
  };
  return {
    fy,
    shortTerm: agg("short"),
    longTerm: agg("long"),
    income: income.filter((i) => financialYear(i.date) === fy).reduce((a, i) => a + i.amount, 0),
    lots: inFy,
  };
}
