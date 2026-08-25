"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Scale, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Acquiring } from "@/components/ui/acquiring";

interface Risk {
  volatility: number | null;
  maxDrawdown: number | null;
  concentration: number;
  topWeight: number;
  topSymbol: string | null;
  cryptoWeight: number;
  bestDay: number | null;
  worstDay: number | null;
  warnings: string[];
}
interface Leg {
  symbol: string; kind: string; currentPct: number; targetPct: number;
  driftPct: number; deltaValue: number; action: "buy" | "trim" | "hold";
}

const n1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Risk profile plus an equal-weight rebalancing plan. */
export function RiskPanel({ reloadKey }: { reloadKey?: number }) {
  const [risk, setRisk] = useState<Risk | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const j = await fetch("/api/portfolio/analytics").then((r) => r.json()).catch(() => null);
    if (j?.ok) { setRisk(j.data.risk); setLegs(j.data.rebalance ?? []); setPoints(j.data.historyPoints ?? 0); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const drifted = legs.filter((l) => l.action !== "hold");

  return (
    <div className="pp-grid2">
      <div className="pp-card">
        <div className="pp-head"><ShieldAlert className="size-3.5" /><h3>RISK</h3><span className="pp-line" /></div>
        {loading && !risk && <Acquiring label="RISK METRICS" />}
        {risk && (
          <>
            <div className="pp-metrics">
              <Metric k="VOLATILITY" v={risk.volatility == null ? "—" : `${n1(risk.volatility)}%`} sub="annualised" />
              <Metric k="MAX DRAWDOWN" v={risk.maxDrawdown == null ? "—" : `${n1(risk.maxDrawdown)}%`} sub="peak to trough" tone={risk.maxDrawdown != null && risk.maxDrawdown < -20 ? "warn" : undefined} />
              <Metric k="TOP POSITION" v={`${n1(risk.topWeight)}%`} sub={risk.topSymbol ?? "—"} tone={risk.topWeight > 40 ? "warn" : undefined} />
              <Metric k="IN CRYPTO" v={`${n1(risk.cryptoWeight)}%`} sub="of book" tone={risk.cryptoWeight > 60 ? "warn" : undefined} />
            </div>
            {risk.volatility == null && (
              <p className="pp-dim">Volatility and drawdown need about a week of daily snapshots — {points} logged so far.</p>
            )}
            {risk.warnings.length > 0 && (
              <div className="pp-warns">
                {risk.warnings.map((w, i) => (
                  <div key={i} className="pp-warn"><AlertTriangle className="size-3.5" /> {w}</div>
                ))}
              </div>
            )}
            {!risk.warnings.length && risk.volatility != null && (
              <p className="pp-ok">Nothing alarming in the shape of the book right now.</p>
            )}
          </>
        )}
      </div>

      <div className="pp-card">
        <div className="pp-head"><Scale className="size-3.5" /><h3>REBALANCE</h3><span className="pp-line" /><span className="pp-tag">EQUAL WEIGHT</span></div>
        {!legs.length && !loading && <p className="pp-dim">Add priced holdings to see a rebalancing plan.</p>}
        {legs.length > 0 && !drifted.length && <p className="pp-ok">Every position is within 5% of an equal weight — nothing to do.</p>}
        {drifted.length > 0 && (
          <div className="pp-legs">
            {drifted.map((l) => (
              <div key={l.symbol} className="pp-leg">
                <span className={cn("pp-legact", l.action)}>{l.action}</span>
                <span className="pp-legsym">{l.symbol}</span>
                <span className="pp-legbar">
                  <i style={{ width: `${Math.min(100, l.currentPct)}%` }} />
                  <b style={{ left: `${Math.min(100, l.targetPct)}%` }} />
                </span>
                <span className="pp-legpct">{l.currentPct.toFixed(0)}% → {l.targetPct.toFixed(0)}%</span>
                <span className={cn("pp-legval", l.deltaValue >= 0 ? "pf-up" : "pf-dn")}>{money(l.deltaValue)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
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
