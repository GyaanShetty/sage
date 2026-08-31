"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Plus, Trash2, FlaskConical, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { asArray } from "@/lib/as-array";

interface Alert {
  id: string; symbol: string; kind: string; condition: string;
  value: number; enabled: boolean; description: string;
}
interface WhatIf {
  symbol: string; amount: number; units: number; entryPrice: number; entryDay: string;
  exitPrice: number; exitDay: string; finalValue: number; pnl: number; pnlPct: number;
  maxDrawdownPct: number; peakValue: number; peakDay: string;
}

const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Price alerts plus a "what if I'd bought" back-test, side by side. */
export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [a, setA] = useState({ symbol: "", kind: "crypto", condition: "above", value: "" });
  const [busy, setBusy] = useState(false);

  const [w, setW] = useState({ symbol: "NVDA", amount: "10000", range: "1y" });
  const [wi, setWi] = useState<WhatIf | null>(null);
  const [wErr, setWErr] = useState<string | null>(null);
  const [wBusy, setWBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/portfolio/alerts").then((r) => r.json()).catch(() => null);
    setAlerts(asArray(j?.data));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!a.symbol.trim() || !a.value) return;
    setBusy(true);
    await fetch("/api/portfolio/alerts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...a, value: Number(a.value) }),
    }).catch(() => {});
    setA({ symbol: "", kind: "crypto", condition: "above", value: "" });
    setBusy(false); load();
  };
  const toggle = async (x: Alert) => {
    setAlerts((p) => p.map((y) => (y.id === x.id ? { ...y, enabled: !y.enabled } : y)));
    await fetch("/api/portfolio/alerts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: x.id, enabled: !x.enabled }),
    }).catch(() => {});
  };
  const del = async (id: string) => {
    setAlerts((p) => p.filter((x) => x.id !== id));
    await fetch(`/api/portfolio/alerts?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  const runWhatIf = async () => {
    setWBusy(true); setWErr(null); setWi(null);
    const j = await fetch(`/api/portfolio/whatif?symbol=${encodeURIComponent(w.symbol)}&amount=${w.amount}&range=${w.range}`)
      .then((r) => r.json()).catch(() => null);
    if (j?.ok) setWi(j.data); else setWErr(j?.error ?? "Couldn't price that.");
    setWBusy(false);
  };

  return (
    <div className="pp-grid2">
      <div className="pp-card">
        <div className="pp-head"><BellRing className="size-3.5" /><h3>PRICE ALERTS</h3><span className="pp-line" /></div>
        <div className="pp-form">
          <input placeholder="Symbol" value={a.symbol} onChange={(e) => setA({ ...a, symbol: e.target.value })} style={{ textTransform: "uppercase" }} />
          <select value={a.kind} onChange={(e) => setA({ ...a, kind: e.target.value })}><option value="crypto">Crypto</option><option value="stock">Stock</option></select>
          <select value={a.condition} onChange={(e) => setA({ ...a, condition: e.target.value })}>
            <option value="above">rises above</option><option value="below">falls below</option>
            <option value="pct_up">gains %/day</option><option value="pct_down">drops %/day</option>
          </select>
          <input type="number" placeholder="Value" value={a.value} onChange={(e) => setA({ ...a, value: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button onClick={add} disabled={busy} className="cc-btn cc-scan"><Plus className="size-3.5" /> Add</button>
        </div>
        <div className="pp-rows">
          {alerts.map((x) => (
            <div key={x.id} className="pp-row">
              <button onClick={() => toggle(x)} className={cn("pp-toggle", x.enabled && "on")} title={x.enabled ? "Disable" : "Enable"}><i /></button>
              <span className="pp-rsym" style={{ flex: 1 }}>{x.description}</span>
              <button onClick={() => del(x.id)} className="cc-del"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
          {!alerts.length && <p className="pp-dim">No alerts. SAGE checks these on the cron tick and pushes when one trips.</p>}
        </div>
      </div>

      <div className="pp-card">
        <div className="pp-head"><FlaskConical className="size-3.5" /><h3>WHAT IF I&rsquo;D BOUGHT</h3><span className="pp-line" /></div>
        <div className="pp-form">
          <input placeholder="Symbol" value={w.symbol} onChange={(e) => setW({ ...w, symbol: e.target.value })} style={{ textTransform: "uppercase" }} />
          <input type="number" placeholder="Amount $" value={w.amount} onChange={(e) => setW({ ...w, amount: e.target.value })} />
          <select value={w.range} onChange={(e) => setW({ ...w, range: e.target.value })}>
            {["1mo", "3mo", "6mo", "1y", "2y", "5y"].map((r) => <option key={r} value={r}>{r} ago</option>)}
          </select>
          <button onClick={runWhatIf} disabled={wBusy || !w.symbol.trim()} className="cc-btn cc-scan">
            {wBusy ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />} Run
          </button>
        </div>
        {wErr && <p className="pp-dim">{wErr}</p>}
        {wi && (
          <>
            <div className="pp-metrics">
              <Metric k="WORTH NOW" v={money(wi.finalValue)} sub={`from ${money(wi.amount)}`} />
              <Metric k="P&L" v={`${wi.pnl >= 0 ? "+" : ""}${wi.pnlPct.toFixed(1)}%`} sub={money(wi.pnl)} tone={wi.pnl < 0 ? "warn" : undefined} />
              <Metric k="PEAK" v={money(wi.peakValue)} sub={wi.peakDay} />
              <Metric k="WORST DIP" v={`${wi.maxDrawdownPct.toFixed(1)}%`} sub="along the way" tone={wi.maxDrawdownPct < -25 ? "warn" : undefined} />
            </div>
            <p className="pp-dim" style={{ marginTop: 10 }}>
              {wi.units.toFixed(4)} units at {wi.entryPrice.toFixed(2)} on {wi.entryDay}, now {wi.exitPrice.toFixed(2)}.
              Ignores fees, taxes and dividends.
            </p>
          </>
        )}
        {!wi && !wErr && !wBusy && <p className="pp-dim">Price a hypothetical against real history.</p>}
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
