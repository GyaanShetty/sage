"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { Acquiring } from "@/components/ui/acquiring";

/**
 * Where the money came from.
 *
 * A book can be up while most of it is down — one position carrying the rest.
 * Total return never shows that, and it is the first thing worth knowing
 * before you add to a winner.
 */

interface Contribution {
  symbol: string; kind: string; pnl: number; pnlPct: number; weight: number; share: number;
}
interface Attribution {
  contributions: Contribution[];
  best: Contribution | null;
  worst: Contribution | null;
  totalPnl: number;
  winners: number;
  losers: number;
  drivenByOne: boolean;
  notes: string[];
}
interface Adjusted { sharpe: number | null; sortino: number | null; days: number }

const money = (n: number) => (n < 0 ? "-$" : "+$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

export function AttributionPanel({ reloadKey }: { reloadKey?: number }) {
  const [attr, setAttr] = useState<Attribution | null>(null);
  const [adj, setAdj] = useState<Adjusted | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const j = await fetch("/api/portfolio/analytics").then((r) => r.json()).catch(() => null);
    if (j?.ok) { setAttr(j.data.attribution ?? null); setAdj(j.data.riskAdjusted ?? null); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const rows = attr?.contributions ?? [];
  // Bars are scaled to the largest single move so the smallest one is still
  // visible; scaling to the total would flatten everything but the leader.
  const peak = Math.max(1, ...rows.map((c) => Math.abs(c.pnl)));

  return (
    <div className="pp-card mt-4">
      <div className="pp-head">
        <Target className="size-3.5" /><h3>ATTRIBUTION</h3><span className="pp-line" />
        {attr && <span className="pp-tag">{attr.winners}↑ {attr.losers}↓</span>}
      </div>

      {loading && !attr && <Acquiring label="ATTRIBUTION" />}
      {attr && rows.length === 0 && <p className="pp-dim">Add priced holdings to see what is driving the book.</p>}

      {attr && rows.length > 0 && (
        <>
          <div className="mt-2 flex flex-col gap-1.5">
            {rows.map((c) => (
              <div key={c.symbol} className="flex items-center gap-2 text-[12px]">
                <span className="w-14 shrink-0 truncate font-mono text-[11px]">{c.symbol}</span>
                <span className="relative h-1.5 min-w-0 flex-1 bg-glass-strong">
                  <i
                    className={cn("absolute top-0 block h-full", c.pnl >= 0 ? "bg-[var(--live)]" : "bg-red-400/70")}
                    style={{
                      width: `${(Math.abs(c.pnl) / peak) * 50}%`,
                      left: c.pnl >= 0 ? "50%" : undefined,
                      right: c.pnl < 0 ? "50%" : undefined,
                    }}
                  />
                  <b className="absolute left-1/2 top-0 h-full w-px bg-border-glass" />
                </span>
                <span className={cn("w-20 shrink-0 text-right font-mono text-[11px]", c.pnl >= 0 ? "pf-up" : "pf-dn")}>
                  {money(c.pnl)}
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[10px] text-subtle">
                  {c.weight.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>

          <div className="pp-metrics mt-3">
            <Metric k="TOTAL P&L" v={money(attr.totalPnl)} sub="unrealised" />
            <Metric
              k="BIGGEST DRIVER"
              v={attr.best ? `${Math.abs(attr.best.share).toFixed(0)}%` : "—"}
              sub={attr.best?.symbol ?? "—"}
              tone={attr.drivenByOne ? "warn" : undefined}
            />
            <Metric
              k="SHARPE"
              v={adj?.sharpe == null ? "—" : adj.sharpe.toFixed(2)}
              sub={adj?.sharpe == null ? `needs ~20 days (${adj?.days ?? 0})` : "risk-adjusted"}
            />
            <Metric
              k="SORTINO"
              v={adj?.sortino == null ? "—" : adj.sortino.toFixed(2)}
              sub="downside only"
            />
          </div>

          {attr.notes.length > 0 && (
            <div className="pp-warns">
              {attr.notes.map((n, i) => (
                <div key={i} className="pp-warn"><AlertTriangle className="size-3.5" /> {n}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ k, v, sub, tone }: { k: string; v: string; sub: string; tone?: "warn" }) {
  return (
    <div className={cn("pp-metric", tone)}>
      <span className="pp-mk">{k}</span>
      <span className="pp-mv">{v}</span>
      <span className="pp-ms">{sub}</span>
    </div>
  );
}
