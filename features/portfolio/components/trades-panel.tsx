"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt, Plus, Trash2, Loader2, Download, Coins } from "lucide-react";
import { cn } from "@/lib/utils";

interface Trade { id: string; symbol: string; kind: string; side: string; qty: number; price: number; fees: number; date: string }
interface Income { id: string; symbol: string; kind: string; amount: number; date: string }
interface Lot { symbol: string; kind: string; qty: number; proceeds: number; costBasis: number; pnl: number; openedAt: string | null; closedAt: string; term: "short" | "long" }
interface Agg { proceeds: number; costBasis: number; pnl: number; count: number }
interface Report { fy: string; shortTerm: Agg; longTerm: Agg; income: number; lots: Lot[] }
interface Data { trades: Trade[]; income: Income[]; realized: Lot[]; realizedTotal: number; incomeTotal: number; report: Report; years: string[] }

const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Trade log, FIFO-realized P&L, income, and an Indian-FY capital-gains view. */
export function TradesPanel({ onChange }: { onChange?: () => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [fy, setFy] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"trades" | "income" | "tax">("trades");
  const [t, setT] = useState({ symbol: "", kind: "crypto", side: "buy", qty: "", price: "", fees: "" });
  const [inc, setInc] = useState({ symbol: "", kind: "dividend", amount: "" });

  const load = useCallback(async (year?: string) => {
    const j = await fetch(`/api/portfolio/trades${year ? `?fy=${year}` : ""}`).then((r) => r.json()).catch(() => null);
    if (j?.ok) { setD(j.data); if (!year) setFy(j.data.report.fy); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addTrade = async () => {
    if (!t.symbol.trim() || !t.qty) return;
    setBusy(true);
    await fetch("/api/portfolio/trades", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...t, qty: Number(t.qty), price: Number(t.price), fees: Number(t.fees) || 0 }),
    }).catch(() => {});
    setT({ symbol: "", kind: "crypto", side: "buy", qty: "", price: "", fees: "" });
    setBusy(false); load(fy); onChange?.();
  };
  const addIncome = async () => {
    if (!inc.symbol.trim() || !inc.amount) return;
    setBusy(true);
    await fetch("/api/portfolio/trades", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ entry: "income", ...inc, amount: Number(inc.amount) }),
    }).catch(() => {});
    setInc({ symbol: "", kind: "dividend", amount: "" });
    setBusy(false); load(fy); onChange?.();
  };
  const del = async (id: string, entry?: "income") => {
    await fetch(`/api/portfolio/trades?id=${id}${entry ? "&entry=income" : ""}`, { method: "DELETE" }).catch(() => {});
    load(fy); onChange?.();
  };

  const exportTax = () => {
    if (!d) return;
    const rows = [["symbol", "kind", "qty", "openedAt", "closedAt", "term", "proceeds", "costBasis", "pnl"]];
    for (const l of d.report.lots) {
      rows.push([l.symbol, l.kind, String(l.qty), l.openedAt?.slice(0, 10) ?? "", l.closedAt.slice(0, 10), l.term,
        l.proceeds.toFixed(2), l.costBasis.toFixed(2), l.pnl.toFixed(2)]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `sage-capital-gains-${d.report.fy}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pp-card">
      <div className="pp-head">
        <Receipt className="size-3.5" /><h3>TRADES &amp; REALIZED P&amp;L</h3><span className="pp-line" />
        <div className="pp-tabs">
          {(["trades", "income", "tax"] as const).map((x) => (
            <button key={x} onClick={() => setTab(x)} className={cn("pp-tab", tab === x && "on")}>{x.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {d && (
        <div className="pp-stats" style={{ marginBottom: 12 }}>
          <div className="pp-stat"><span className="pp-sk">REALIZED</span><span className={cn("pp-sv", d.realizedTotal >= 0 ? "pf-up" : "pf-dn")}>{money(d.realizedTotal)}</span></div>
          <div className="pp-stat"><span className="pp-sk">INCOME</span><span className="pp-sv pf-up">{money(d.incomeTotal)}</span></div>
          <div className="pp-stat"><span className="pp-sk">CLOSED LOTS</span><span className="pp-sv">{d.realized.length}</span></div>
        </div>
      )}

      {tab === "trades" && (
        <>
          <div className="pp-form">
            <input placeholder="Symbol" value={t.symbol} onChange={(e) => setT({ ...t, symbol: e.target.value })} style={{ textTransform: "uppercase" }} />
            <select value={t.side} onChange={(e) => setT({ ...t, side: e.target.value })}><option value="buy">Buy</option><option value="sell">Sell</option></select>
            <select value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value })}><option value="crypto">Crypto</option><option value="stock">Stock</option></select>
            <input type="number" placeholder="Qty" value={t.qty} onChange={(e) => setT({ ...t, qty: e.target.value })} />
            <input type="number" placeholder="Price" value={t.price} onChange={(e) => setT({ ...t, price: e.target.value })} />
            <input type="number" placeholder="Fees" value={t.fees} onChange={(e) => setT({ ...t, fees: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addTrade()} />
            <button onClick={addTrade} disabled={busy} className="cc-btn cc-scan">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Log</button>
          </div>
          <div className="pp-rows">
            {(d?.trades ?? []).slice(0, 12).map((x) => (
              <div key={x.id} className="pp-row">
                <span className={cn("pp-side", x.side)}>{x.side}</span>
                <span className="pp-rsym">{x.symbol}</span>
                <span className="pp-rnum">{x.qty} @ {x.price}</span>
                <span className="pp-rdate">{x.date.slice(0, 10).slice(5)}</span>
                <button onClick={() => del(x.id)} className="cc-del"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
            {d && !d.trades.length && <p className="pp-dim">No trades logged. Add buys and sells here and SAGE works out realized P&amp;L by FIFO.</p>}
          </div>
          {(d?.realized.length ?? 0) > 0 && (
            <div className="pp-rows" style={{ marginTop: 12 }}>
              <span className="pp-sub">CLOSED LOTS</span>
              {d!.realized.slice(0, 6).map((l, i) => (
                <div key={i} className="pp-row">
                  <span className={cn("pp-term", l.term)}>{l.term}</span>
                  <span className="pp-rsym">{l.symbol}</span>
                  <span className="pp-rnum">{l.qty.toFixed(4)}</span>
                  <span className={cn("pp-rnum", l.pnl >= 0 ? "pf-up" : "pf-dn")}>{money(l.pnl)}</span>
                  <span className="pp-rdate">{l.closedAt.slice(5, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "income" && (
        <>
          <div className="pp-form">
            <input placeholder="Symbol" value={inc.symbol} onChange={(e) => setInc({ ...inc, symbol: e.target.value })} style={{ textTransform: "uppercase" }} />
            <select value={inc.kind} onChange={(e) => setInc({ ...inc, kind: e.target.value })}>
              <option value="dividend">Dividend</option><option value="staking">Staking</option><option value="interest">Interest</option>
            </select>
            <input type="number" placeholder="Amount" value={inc.amount} onChange={(e) => setInc({ ...inc, amount: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addIncome()} />
            <button onClick={addIncome} disabled={busy} className="cc-btn cc-scan"><Coins className="size-3.5" /> Add</button>
          </div>
          <div className="pp-rows">
            {(d?.income ?? []).slice(0, 12).map((x) => (
              <div key={x.id} className="pp-row">
                <span className="pp-side buy">{x.kind}</span>
                <span className="pp-rsym">{x.symbol}</span>
                <span className="pp-rnum pf-up">{money(x.amount)}</span>
                <span className="pp-rdate">{x.date.slice(5, 10)}</span>
                <button onClick={() => del(x.id, "income")} className="cc-del"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
            {d && !d.income.length && <p className="pp-dim">No dividends or staking income recorded yet.</p>}
          </div>
        </>
      )}

      {tab === "tax" && d && (
        <>
          <div className="pp-head" style={{ marginBottom: 10 }}>
            <span className="pp-tag">INDIAN FY</span>
            <select value={fy} onChange={(e) => { setFy(e.target.value); load(e.target.value); }} className="pp-select">
              {(d.years.length ? d.years : [d.report.fy]).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="pp-line" />
            <button onClick={exportTax} disabled={!d.report.lots.length} className="cc-btn"><Download className="size-3.5" /> CSV</button>
          </div>
          <div className="pp-metrics">
            <Metric k="SHORT TERM" v={money(d.report.shortTerm.pnl)} sub={`${d.report.shortTerm.count} lots`} tone={d.report.shortTerm.pnl < 0 ? "warn" : undefined} />
            <Metric k="LONG TERM" v={money(d.report.longTerm.pnl)} sub={`${d.report.longTerm.count} lots`} tone={d.report.longTerm.pnl < 0 ? "warn" : undefined} />
            <Metric k="INCOME" v={money(d.report.income)} sub="dividends + staking" />
            <Metric k="NET" v={money(d.report.shortTerm.pnl + d.report.longTerm.pnl + d.report.income)} sub={d.report.fy} />
          </div>
          <p className="pp-dim" style={{ marginTop: 10 }}>
            Lots are matched FIFO. Long term is over 12 months for equity and over 36 months otherwise — a rule of thumb,
            not tax advice, and it can&apos;t see trades you haven&apos;t logged.
          </p>
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
