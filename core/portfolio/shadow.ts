import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * The shadow book: trades considered and not taken.
 *
 * Everyone is convinced the ones they skipped would have won. Almost nobody
 * checks, because nothing records a trade that never happened — the brokerage
 * only knows about the ones you placed, so the skipped ones live entirely in
 * memory, where they are free to have been brilliant.
 *
 * This records them at the price you would have paid, and scores the ghost
 * portfolio against reality later. It is the decision journal pointed at
 * markets, and it answers a question the real portfolio structurally cannot:
 * is your hesitation costing you, or saving you?
 */

const TYPE = "portfolio.shadow";

export type Side = "buy" | "short";

export interface ShadowTrade {
  id: string;
  symbol: string;
  side: Side;
  /** What you would have paid, in the instrument's own currency. */
  price: number;
  /** Units. Fractional is fine — this is a thought experiment with numbers. */
  size: number;
  /** Why you were tempted, and why you didn't. Both matter later. */
  thesis: string;
  whyNot: string;
  at: string;
  /** Set when the ghost is closed out, so it stops accruing forever. */
  closedAt?: string | null;
  closedPrice?: number | null;
}

export interface ShadowScore extends ShadowTrade {
  /** Live or closing price used for the score. Null when unquotable. */
  markPrice: number | null;
  /** Money you did not make, or did not lose. Negative means skipping was right. */
  pnl: number | null;
  pnlPct: number | null;
  days: number;
}

export interface ShadowSummary {
  trades: ShadowScore[];
  /** Total of every ghost, in the quote currency — mixed, so it is indicative. */
  netPnl: number;
  /** How many skips would have made money. */
  wouldHaveWon: number;
  scored: number;
  /**
   * The one sentence that matters, phrased against what he actually did.
   * Skipping is the action being judged here, not the trade.
   */
  verdict: string;
}

export async function listShadow(limit = 100): Promise<ShadowTrade[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<ShadowTrade, "id">) }));
}

export async function addShadow(input: Omit<ShadowTrade, "id" | "at">): Promise<string> {
  const id = crypto.randomUUID();
  await db.from("Event").insert({
    id, userId: DEFAULT_USER_ID, type: TYPE,
    payload: {
      symbol: input.symbol.trim().toUpperCase().slice(0, 20),
      side: input.side === "short" ? "short" : "buy",
      price: Math.max(0, Number(input.price) || 0),
      size: Math.max(0, Number(input.size) || 0),
      thesis: input.thesis.trim().slice(0, 1000),
      whyNot: input.whyNot.trim().slice(0, 500),
      at: new Date().toISOString(),
      closedAt: null,
      closedPrice: null,
    },
  });
  return id;
}

export async function closeShadow(id: string, price: number): Promise<void> {
  const { data } = await db.from("Event").select("payload").eq("id", id).eq("userId", DEFAULT_USER_ID).maybeSingle();
  if (!data) return;
  await db.from("Event").update({
    payload: { ...(data.payload as object), closedAt: new Date().toISOString(), closedPrice: Number(price) || 0 },
  }).eq("id", id);
}

export async function deleteShadow(id: string): Promise<void> {
  const { trashRow } = await import("@/core/ops/trash");
  await trashRow("Event", id);
}

/**
 * What the trade would have made.
 *
 * A short is the mirror of a long, not a special case — writing it as one
 * signed expression means there is one formula to be wrong about rather than
 * two.
 */
export function pnlOf(trade: ShadowTrade, mark: number): number {
  const direction = trade.side === "short" ? -1 : 1;
  return (mark - trade.price) * trade.size * direction;
}

/** A verdict on the skipping, not on the trades. */
function verdictFor(scored: number, won: number, net: number): string {
  if (scored === 0) return "Nothing scored yet — a skipped trade needs time before it means anything.";
  if (scored < 5) return `Only ${scored} scored. Read it as a sketch; hesitation needs a bigger sample than conviction does.`;

  const rate = Math.round((won / scored) * 100);
  const money = `${net >= 0 ? "" : "−"}${Math.abs(Math.round(net)).toLocaleString("en-IN")}`;

  if (net > 0 && rate >= 60) {
    return `Your hesitation has cost you: ${rate}% of the trades you passed on went your way, worth about ${money}. The instinct was right and you did not act on it.`;
  }
  if (net < 0) {
    return `Skipping has saved you about ${money}. ${rate}% would have won, so the caution is doing real work — this is a discipline, not a weakness.`;
  }
  return `About even: ${rate}% of your skipped trades would have won, netting roughly ${money}. No evidence either way yet.`;
}

/**
 * Score the book against live prices.
 *
 * Quotes come from the same free sources the rest of the app uses, so anything
 * they cannot price is reported as unscored rather than guessed at — a ghost
 * portfolio full of invented marks would be worse than none.
 */
export async function scoreShadow(): Promise<ShadowSummary> {
  const trades = await listShadow();
  if (trades.length === 0) {
    return { trades: [], netPnl: 0, wouldHaveWon: 0, scored: 0, verdict: verdictFor(0, 0, 0) };
  }

  const { getMarkets, getStocks } = await import("@/infrastructure/markets");
  const [coins, stocks] = await Promise.all([
    getMarkets().catch(() => null),
    getStocks().catch(() => null),
  ]);

  const quote = new Map<string, number>();
  for (const c of coins ?? []) quote.set(c.symbol.toUpperCase(), c.price);
  for (const s of stocks ?? []) quote.set(s.symbol.toUpperCase(), s.price);

  const scoredTrades: ShadowScore[] = trades.map((t) => {
    // A closed ghost is frozen at its closing price; a live one marks to
    // market. Both beat leaving a skipped trade open forever.
    const mark = t.closedPrice ?? quote.get(t.symbol.toUpperCase()) ?? null;
    const pnl = mark === null ? null : pnlOf(t, mark);
    const notional = t.price * t.size;
    return {
      ...t,
      markPrice: mark,
      pnl,
      pnlPct: pnl === null || notional === 0 ? null : (pnl / notional) * 100,
      days: Math.floor((Date.now() - new Date(t.at).getTime()) / 86_400_000),
    };
  });

  const withPnl = scoredTrades.filter((t) => t.pnl !== null);
  const net = withPnl.reduce((a, t) => a + (t.pnl as number), 0);
  const won = withPnl.filter((t) => (t.pnl as number) > 0).length;

  return {
    trades: scoredTrades,
    netPnl: net,
    wouldHaveWon: won,
    scored: withPnl.length,
    verdict: verdictFor(withPnl.length, won, net),
  };
}
