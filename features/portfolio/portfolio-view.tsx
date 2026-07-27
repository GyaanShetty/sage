"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Trash2, TrendingUp, TrendingDown, Loader2, Newspaper, Wallet, X, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/features/dashboard/command.css";

interface Position {
  id: string; symbol: string; kind: "crypto" | "stock"; qty: number; avgCost: number; thesis?: string | null;
  price: number | null; value: number | null; cost: number; pnl: number | null; pnlPct: number | null; change24h: number | null;
}
interface Totals { value: number; cost: number; pnl: number; pnlPct: number }
interface NewsLink { symbol: string; title: string; link: string; source: string }

const fmt = (n: number | null, d = 2) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const money = (n: number | null) => (n == null ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));

export function PortfolioView() {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [news, setNews] = useState<NewsLink[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ symbol: "", kind: "crypto", qty: "", avgCost: "", thesis: "" });
  const [editThesis, setEditThesis] = useState<string | null>(null);
  const [thesisText, setThesisText] = useState("");

  const load = useCallback(async () => {
    const j = await fetch("/api/portfolio").then((r) => r.json()).catch(() => null);
    setPositions(j?.data?.positions ?? []);
    setTotals(j?.data?.totals ?? null);
    fetch("/api/portfolio/news").then((r) => r.json()).then((n) => setNews(n?.data ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const add = async () => {
    if (!form.symbol.trim() || !form.qty) return;
    setAdding(false);
    await fetch("/api/portfolio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: form.symbol, kind: form.kind, qty: Number(form.qty), avgCost: Number(form.avgCost), thesis: form.thesis.trim() || null }) });
    setForm({ symbol: "", kind: "crypto", qty: "", avgCost: "", thesis: "" });
    load();
  };
  const remove = async (id: string) => { setPositions((p) => p?.filter((x) => x.id !== id) ?? p); await fetch(`/api/portfolio?id=${id}`, { method: "DELETE" }); };
  const saveThesis = async (id: string) => {
    setEditThesis(null);
    setPositions((p) => p?.map((x) => (x.id === id ? { ...x, thesis: thesisText } : x)) ?? p);
    await fetch("/api/portfolio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, thesis: thesisText }) });
  };

  const up = (totals?.pnl ?? 0) >= 0;

  return (
    <div className="pf-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}><span className="sn">PF</span><h2>Portfolio</h2><span className="line" /><span className="tag">LIVE P&amp;L · NEWS-LINKED</span></div>
        <button onClick={() => setAdding((s) => !s)} className="cc-btn cc-scan"><Plus className="size-3.5" /> Add holding</button>
      </div>

      {/* totals */}
      {totals && (
        <div className="pf-totals">
          <div className="pf-tcard"><span className="pf-tk">TOTAL VALUE</span><span className="pf-tv">{money(totals.value)}</span></div>
          <div className="pf-tcard"><span className="pf-tk">COST BASIS</span><span className="pf-tv">{money(totals.cost)}</span></div>
          <div className="pf-tcard"><span className="pf-tk">UNREALIZED P&amp;L</span><span className={cn("pf-tv", up ? "pf-up" : "pf-dn")}>{money(totals.pnl)} <small>({up ? "+" : ""}{fmt(totals.pnlPct, 1)}%)</small></span></div>
        </div>
      )}

      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="pf-addform">
              <input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="Symbol (BTC, AAPL…)" style={{ textTransform: "uppercase" }} />
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="crypto">Crypto</option><option value="stock">Stock</option></select>
              <input value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="Quantity" type="number" />
              <input value={form.avgCost} onChange={(e) => setForm({ ...form, avgCost: e.target.value })} placeholder="Avg cost / unit" type="number" />
              <input value={form.thesis} onChange={(e) => setForm({ ...form, thesis: e.target.value })} placeholder="Thesis (optional)" onKeyDown={(e) => e.key === "Enter" && add()} />
              <button onClick={add} className="cc-btn cc-scan">Add</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* holdings table */}
      <div className="pf-table">
        <div className="pf-throw pf-thead"><span>ASSET</span><span>QTY</span><span>AVG</span><span>PRICE</span><span>24H</span><span>VALUE</span><span>P&amp;L</span><span /></div>
        {positions === null && <p className="lbl" style={{ padding: 14 }}>LOADING…</p>}
        {positions?.map((p) => {
          const pu = (p.pnl ?? 0) >= 0;
          return (
            <div key={p.id} className="pf-holding">
              <div className="pf-throw">
                <span className="pf-sym">{p.symbol}<i>{p.kind}</i></span>
                <span>{fmt(p.qty, p.qty < 1 ? 4 : 2)}</span>
                <span>{fmt(p.avgCost)}</span>
                <span>{p.price == null ? "—" : "$" + fmt(p.price)}</span>
                <span className={cn(p.change24h != null && (p.change24h >= 0 ? "pf-up" : "pf-dn"))}>{p.change24h == null ? "—" : `${p.change24h >= 0 ? "+" : ""}${fmt(p.change24h, 1)}%`}</span>
                <span>{money(p.value)}</span>
                <span className={cn(pu ? "pf-up" : "pf-dn")}>{money(p.pnl)}<small> {p.pnlPct == null ? "" : `${pu ? "+" : ""}${fmt(p.pnlPct, 1)}%`}</small></span>
                <span className="pf-rowbtns">
                  <button onClick={() => { setEditThesis(p.id); setThesisText(p.thesis ?? ""); }} title="Thesis"><PencilLine className="size-3.5" /></button>
                  <button onClick={() => remove(p.id)} title="Remove" className="cc-del"><Trash2 className="size-3.5" /></button>
                </span>
              </div>
              {editThesis === p.id ? (
                <div className="pf-thesisedit">
                  <input value={thesisText} onChange={(e) => setThesisText(e.target.value)} placeholder="Your thesis for this position…" autoFocus onKeyDown={(e) => e.key === "Enter" && saveThesis(p.id)} />
                  <button onClick={() => saveThesis(p.id)} className="cc-btn cc-scan">Save</button>
                  <button onClick={() => setEditThesis(null)}><X className="size-4" /></button>
                </div>
              ) : p.thesis ? <div className="pf-thesis">“{p.thesis}”</div> : null}
            </div>
          );
        })}
        {positions && positions.length === 0 && (
          <div className="cc-zero"><Wallet className="size-6 opacity-40" /><p>No holdings yet. Add your crypto &amp; stocks to track live P&amp;L and link the news to your positions.</p></div>
        )}
      </div>

      {/* news → positions */}
      {news.length > 0 && (
        <div className="pf-news">
          <div className="sectitle" style={{ margin: "6px 0 12px" }}><span className="sn"><Newspaper className="size-3.5" /></span><h2 style={{ fontSize: 15 }}>News on your book</h2><span className="line" /></div>
          <div className="mb-list">
            {news.map((n, i) => (
              <a key={i} href={n.link} target="_blank" rel="noreferrer" className="mb-item" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="pf-newssym">{n.symbol}</span>
                <div className="mb-itemtext"><div className="mb-title">{n.title}</div><div className="mb-snip">{n.source}</div></div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
