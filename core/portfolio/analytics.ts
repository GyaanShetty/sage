import type { Position } from "./store";
import type { Snapshot } from "./snapshots";

export interface RiskMetrics {
  /** Annualised volatility of daily portfolio returns, in %. */
  volatility: number | null;
  /** Worst peak-to-trough decline over the snapshot window, in %. */
  maxDrawdown: number | null;
  /** Herfindahl index 0–1; >0.25 means meaningfully concentrated. */
  concentration: number;
  /** Largest single position as a share of the book, in %. */
  topWeight: number;
  topSymbol: string | null;
  /** Share of the book in crypto, in %. */
  cryptoWeight: number;
  /** Best/worst single day over the window, in %. */
  bestDay: number | null;
  worstDay: number | null;
  warnings: string[];
}

/** Daily simple returns from an equity curve. */
export function dailyReturns(snaps: Snapshot[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1].value;
    if (prev > 0) out.push((snaps[i].value - prev) / prev);
  }
  return out;
}

export function maxDrawdown(snaps: Snapshot[]): number | null {
  if (snaps.length < 2) return null;
  let peak = snaps[0].value;
  let worst = 0;
  for (const s of snaps) {
    if (s.value > peak) peak = s.value;
    if (peak > 0) worst = Math.min(worst, (s.value - peak) / peak);
  }
  return worst * 100;
}

/** Portfolio risk profile from live positions plus the historical curve. */
export function riskMetrics(positions: Position[], snaps: Snapshot[]): RiskMetrics {
  const priced = positions.filter((p) => (p.value ?? 0) > 0);
  const total = priced.reduce((a, p) => a + (p.value ?? 0), 0);
  const weights = priced.map((p) => (total > 0 ? (p.value ?? 0) / total : 0));
  const concentration = weights.reduce((a, w) => a + w * w, 0);

  let topWeight = 0;
  let topSymbol: string | null = null;
  priced.forEach((p, i) => {
    if (weights[i] > topWeight) { topWeight = weights[i]; topSymbol = p.symbol; }
  });

  const cryptoValue = priced.filter((p) => p.kind === "crypto").reduce((a, p) => a + (p.value ?? 0), 0);
  const cryptoWeight = total > 0 ? (cryptoValue / total) * 100 : 0;

  const rets = dailyReturns(snaps);
  let volatility: number | null = null;
  let bestDay: number | null = null;
  let worstDay: number | null = null;
  if (rets.length >= 5) {
    const mean = rets.reduce((a, r) => a + r, 0) / rets.length;
    const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
    volatility = Math.sqrt(variance) * Math.sqrt(365) * 100;
    bestDay = Math.max(...rets) * 100;
    worstDay = Math.min(...rets) * 100;
  }

  const warnings: string[] = [];
  if (topWeight > 0.4 && topSymbol) warnings.push(`${topSymbol} is ${(topWeight * 100).toFixed(0)}% of the book — a single-name shock hits hard.`);
  if (concentration > 0.3) warnings.push("The book is concentrated; a handful of names drive nearly all the risk.");
  if (cryptoWeight > 60) warnings.push(`${cryptoWeight.toFixed(0)}% sits in crypto — expect large drawdowns.`);
  if (volatility != null && volatility > 60) warnings.push(`Annualised volatility is ~${volatility.toFixed(0)}% — very high.`);
  if (priced.length > 0 && priced.length < 3) warnings.push("Fewer than three priced positions — little diversification.");

  return { volatility, maxDrawdown: maxDrawdown(snaps), concentration, topWeight: topWeight * 100, topSymbol, cryptoWeight, bestDay, worstDay, warnings };
}

export interface RebalanceLeg {
  symbol: string;
  kind: "crypto" | "stock";
  currentPct: number;
  targetPct: number;
  driftPct: number;
  /** Positive = buy this much value; negative = trim. */
  deltaValue: number;
  action: "buy" | "trim" | "hold";
}

/**
 * Compare current weights to a target allocation and size the trades that
 * close the gap. Targets are percentages keyed by symbol; anything missing
 * falls back to an equal weight across the book.
 */
export function rebalance(positions: Position[], targets: Record<string, number> = {}, bandPct = 5): RebalanceLeg[] {
  const priced = positions.filter((p) => (p.value ?? 0) > 0);
  const total = priced.reduce((a, p) => a + (p.value ?? 0), 0);
  if (!total) return [];

  const hasTargets = Object.keys(targets).length > 0;
  const equal = 100 / priced.length;

  return priced
    .map((p) => {
      const currentPct = ((p.value ?? 0) / total) * 100;
      const targetPct = hasTargets ? (targets[p.symbol.toUpperCase()] ?? 0) : equal;
      const driftPct = currentPct - targetPct;
      const deltaValue = (targetPct / 100) * total - (p.value ?? 0);
      const action: RebalanceLeg["action"] = Math.abs(driftPct) < bandPct ? "hold" : driftPct > 0 ? "trim" : "buy";
      return { symbol: p.symbol, kind: p.kind, currentPct, targetPct, driftPct, deltaValue, action };
    })
    .sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}
