"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { Plus, Trash2, Loader2, Newspaper, Wallet, PencilLine, RefreshCw, Receipt, Sparkles, Send, X, Search, Upload, Download, TrendingUp, TrendingDown, PieChart, CandlestickChart, Info, Gavel } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/features/dashboard/command.css";
import "./panels.css";
import { EquityPanel } from "./components/equity-panel";
import { AttributionPanel } from "./components/attribution-panel";
import { RiskPanel } from "./components/risk-panel";
import { TradesPanel } from "./components/trades-panel";
import { AlertsPanel } from "./components/alerts-panel";

interface SymbolHit { symbol: string; name: string; exchange: string; kind: "crypto" | "stock" }

interface Position {
  id: string; symbol: string; kind: "crypto" | "stock"; qty: number; avgCost: number; thesis?: string | null;
  price: number | null; value: number | null; cost: number; pnl: number | null; pnlPct: number | null; change24h: number | null;
}
interface Totals { value: number; cost: number; pnl: number; pnlPct: number }
interface NewsLink { symbol: string; title: string; link: string; source: string }
interface Expense { id: string; amount: number; merchant: string; category: string; date: string; recurring: boolean }
interface Summary { total: number; byCategory: Record<string, number>; recurring: { merchant: string; amount: number }[] }
const CATS = ["food", "transport", "shopping", "subscriptions", "bills", "entertainment", "health", "other"];
// symbol → CoinGecko id, for pushing crypto holdings into the Markets watchlist
const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", LINK: "chainlink", ADA: "cardano",
  DOT: "polkadot", MATIC: "matic-network", DOGE: "dogecoin", AVAX: "avalanche-2",
  XRP: "ripple", BNB: "binancecoin", LTC: "litecoin", ARB: "arbitrum", OP: "optimism",
};
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const fmt = (n: number | null, d = 2) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const money = (n: number | null) => (n == null ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));

export function PortfolioView() {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [news, setNews] = useState<NewsLink[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ symbol: "", kind: "crypto", qty: "", avgCost: "", thesis: "" });
  // symbol search (typeahead) for the add form
  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // csv import
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [editThesis, setEditThesis] = useState<string | null>(null);
  const [thesisText, setThesisText] = useState("");
  // bumped when a trade is logged, so the risk/rebalance panel refetches
  const [analysisKey, setAnalysisKey] = useState(0);
  // per-holding AI: thesis stress-test and plain-English ticker brief
  const [insight, setInsight] = useState<Record<string, { loading: boolean; kind: "thesis" | "explain"; verdict?: string; text?: string }>>({});
  // expenses
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [exp, setExp] = useState({ amount: "", merchant: "", category: "food" });
  const [scanning, setScanning] = useState(false);
  // mentor
  const [mentorQ, setMentorQ] = useState("");
  const [mentorA, setMentorA] = useState<string | null>(null);
  const [mentorBusy, setMentorBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/portfolio").then((r) => r.json()).catch(() => null);
    setPositions(j?.data?.positions ?? []);
    setTotals(j?.data?.totals ?? null);
    fetch("/api/portfolio/news").then((r) => r.json()).then((n) => setNews(n?.data ?? [])).catch(() => {});
  }, []);
  const loadExp = useCallback(async () => {
    const j = await fetch("/api/expenses").then((r) => r.json()).catch(() => null);
    setExpenses(j?.data?.expenses ?? []); setSummary(j?.data?.summary ?? null);
  }, []);
  useEffect(() => { load(); loadExp(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load, loadExp]);

  const addExp = async () => {
    if (!exp.amount) return;
    await fetch("/api/expenses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: Number(exp.amount), merchant: exp.merchant || "—", category: exp.category, recurring: exp.category === "subscriptions" }) });
    setExp({ amount: "", merchant: "", category: "food" }); loadExp();
  };
  const scanReceipts = async () => {
    setScanning(true);
    await fetch("/api/expenses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
    setScanning(false); loadExp();
  };
  const delExp = async (id: string) => { setExpenses((e) => e.filter((x) => x.id !== id)); await fetch(`/api/expenses?id=${id}`, { method: "DELETE" }); loadExp(); };
  const askMentor = async (q?: string) => {
    setMentorBusy(true); setMentorA(null);
    const j = await fetch("/api/finance/mentor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q ?? mentorQ }) }).then((r) => r.json()).catch(() => null);
    setMentorA(j?.data?.answer ?? "Couldn't reach the mentor just now."); setMentorBusy(false);
  };

  const checkThesis = async (p: Position) => {
    setInsight((s) => ({ ...s, [p.id]: { loading: true, kind: "thesis" } }));
    const j = await fetch("/api/portfolio/thesis", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: p.id }),
    }).then((r) => r.json()).catch(() => null);
    setInsight((s) => ({
      ...s,
      [p.id]: j?.ok
        ? { loading: false, kind: "thesis", verdict: j.data.verdict, text: `${j.data.assessment}\n\n${j.data.question}` }
        : { loading: false, kind: "thesis", text: j?.error ?? "Couldn't review that just now." },
    }));
  };

  const explain = async (p: Position) => {
    setInsight((s) => ({ ...s, [p.id]: { loading: true, kind: "explain" } }));
    const j = await fetch("/api/market/explain", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: p.symbol, context: p.thesis ?? undefined }),
    }).then((r) => r.json()).catch(() => null);
    setInsight((s) => ({
      ...s,
      [p.id]: { loading: false, kind: "explain", text: j?.ok ? j.data.explanation : "Couldn't reach the model just now." },
    }));
  };

  const add = async () => {
    if (!form.symbol.trim() || !form.qty) return;
    setAdding(false);
    await fetch("/api/portfolio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: form.symbol, kind: form.kind, qty: Number(form.qty), avgCost: Number(form.avgCost), thesis: form.thesis.trim() || null }) });
    setForm({ symbol: "", kind: "crypto", qty: "", avgCost: "", thesis: "" });
    setHits([]);
    load();
  };

  // typeahead symbol search (debounced)
  const onSymbol = (v: string) => {
    setForm((f) => ({ ...f, symbol: v }));
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (v.trim().length < 1) { setHits([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const j = await fetch(`/api/market/search?q=${encodeURIComponent(v.trim())}`).then((r) => r.json()).catch(() => null);
      setHits(j?.data ?? []);
      setSearching(false);
    }, 250);
  };
  const pickHit = (h: SymbolHit) => {
    setForm((f) => ({ ...f, symbol: h.symbol, kind: h.kind }));
    setHits([]);
  };

  // CSV export of current holdings
  const exportCsv = () => {
    const rows = [["symbol", "kind", "qty", "avgCost", "thesis"]];
    for (const p of positions ?? []) rows.push([p.symbol, p.kind, String(p.qty), String(p.avgCost), (p.thesis ?? "").replace(/,/g, ";")]);
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `sage-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };
  // CSV import from a chosen file
  const importCsv = async (file: File) => {
    setImporting(true); setImportMsg(null);
    try {
      const csv = await file.text();
      const j = await fetch("/api/portfolio/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv }) }).then((r) => r.json());
      if (j?.ok) { setImportMsg(`Imported ${j.data.added} new · merged ${j.data.merged}`); load(); }
      else setImportMsg(j?.error ?? "Import failed — check the columns (symbol, kind, qty, avgCost).");
    } catch { setImportMsg("Couldn't read that file."); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  // add a holding to the Markets watchlist (bidirectional markets↔portfolio link)
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const trackInMarkets = (p: Position) => {
    try {
      const raw = localStorage.getItem("sage-market-config");
      const cfg = raw ? JSON.parse(raw) : { indices: ["^NSEI", "^BSESN"], stocks: [], crypto: [] };
      if (p.kind === "crypto") {
        const id = CRYPTO_IDS[p.symbol.toUpperCase()] ?? p.symbol.toLowerCase();
        if (!cfg.crypto.includes(id)) cfg.crypto = [...cfg.crypto, id];
      } else {
        if (!cfg.stocks.includes(p.symbol)) cfg.stocks = [...cfg.stocks, p.symbol];
      }
      localStorage.setItem("sage-market-config", JSON.stringify(cfg));
      setTracked((s) => new Set(s).add(p.id));
    } catch { /* ignore */ }
  };

  const remove = async (id: string) => { setPositions((p) => p?.filter((x) => x.id !== id) ?? p); await fetch(`/api/portfolio?id=${id}`, { method: "DELETE" }); };
  const saveThesis = async (id: string) => {
    setEditThesis(null);
    setPositions((p) => p?.map((x) => (x.id === id ? { ...x, thesis: thesisText } : x)) ?? p);
    await fetch("/api/portfolio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, thesis: thesisText }) });
  };

  const up = (totals?.pnl ?? 0) >= 0;

  // ── living-tracker metrics, derived from live positions ──────────────
  const priced = (positions ?? []).filter((p) => p.value != null && p.value > 0);
  const totalValue = totals?.value ?? 0;
  // today's move: Σ value × 24h% (uses each position's live change)
  const dayChange = priced.reduce((a, p) => a + (p.value ?? 0) * ((p.change24h ?? 0) / 100), 0);
  const dayPrevValue = priced.reduce((a, p) => a + (p.value ?? 0) / (1 + (p.change24h ?? 0) / 100), 0);
  const dayPct = dayPrevValue > 0 ? (dayChange / dayPrevValue) * 100 : 0;
  const dayUp = dayChange >= 0;
  // allocation by position (share of total value), largest first
  const allocation = [...priced]
    .map((p) => ({ symbol: p.symbol, kind: p.kind, value: p.value ?? 0, pct: totalValue > 0 ? ((p.value ?? 0) / totalValue) * 100 : 0, change24h: p.change24h }))
    .sort((a, b) => b.value - a.value);
  // biggest movers today (by 24h %), needs at least a couple of priced names
  const movers = priced.filter((p) => p.change24h != null).sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0));
  const topGainer = [...movers].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))[0];
  const topLoser = [...movers].sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0))[0];
  const allocTint = ["#f4f5f7", "#a855f7", "#f59e0b", "#34d399", "#f472b6", "#60a5fa", "#f87171", "#c4b5fd"];

  return (
    <div className="pf-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}><span className="sn">PF</span><h2>Portfolio</h2><span className="line" /><span className="tag">LIVE P&amp;L · NEWS-LINKED</span></div>
        <div className="pf-headbtns">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={importing} className="cc-btn" title="Import holdings from CSV">{importing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Import</button>
          <button onClick={exportCsv} disabled={!positions?.length} className="cc-btn" title="Export holdings to CSV"><Download className="size-3.5" /> Export</button>
          <button onClick={() => setAdding((s) => !s)} className="cc-btn cc-scan"><Plus className="size-3.5" /> Add holding</button>
        </div>
      </div>
      {importMsg && <div className="pf-importmsg">{importMsg}</div>}

      {/* totals */}
      {totals && (
        <div className="pf-totals">
          <div className="pf-tcard"><span className="pf-tk">TOTAL VALUE</span><span className="pf-tv">{money(totals.value)}</span></div>
          <div className="pf-tcard"><span className="pf-tk">COST BASIS</span><span className="pf-tv">{money(totals.cost)}</span></div>
          <div className="pf-tcard"><span className="pf-tk">UNREALIZED P&amp;L</span><span className={cn("pf-tv", up ? "pf-up" : "pf-dn")}>{money(totals.pnl)} <small>({up ? "+" : ""}{fmt(totals.pnlPct, 1)}%)</small></span></div>
          <div className="pf-tcard"><span className="pf-tk">TODAY</span><span className={cn("pf-tv", dayUp ? "pf-up" : "pf-dn")}>{money(dayChange)} <small>({dayUp ? "+" : ""}{fmt(dayPct, 1)}%)</small></span></div>
        </div>
      )}

      {/* living tracker: allocation + movers */}
      {priced.length > 0 && (
        <div className="pf-live">
          <div className="pf-alloc">
            <div className="sectitle" style={{ margin: "0 0 10px" }}><span className="sn"><PieChart className="size-3.5" /></span><h2 style={{ fontSize: 14 }}>Allocation</h2><span className="line" /></div>
            <div className="pf-allocbar">
              {allocation.map((a, i) => <span key={a.symbol} style={{ width: `${a.pct}%`, background: allocTint[i % allocTint.length] }} title={`${a.symbol} · ${fmt(a.pct, 1)}%`} />)}
            </div>
            <div className="pf-alloclegend">
              {allocation.slice(0, 6).map((a, i) => (
                <span key={a.symbol} className="pf-alloclg"><i style={{ background: allocTint[i % allocTint.length] }} />{a.symbol} <b>{fmt(a.pct, 1)}%</b></span>
              ))}
            </div>
          </div>
          {(topGainer || topLoser) && (
            <div className="pf-movers">
              <div className="sectitle" style={{ margin: "0 0 10px" }}><span className="sn"><CandlestickChart className="size-3.5" /></span><h2 style={{ fontSize: 14 }}>Today’s movers</h2><span className="line" /><Link href="/markets" className="pf-mktlink"><CandlestickChart className="size-3" /> Markets</Link></div>
              <div className="pf-moverrow">
                {topGainer && (
                  <div className="pf-mover"><TrendingUp className="size-4 pf-up" /><span className="pf-moversym">{topGainer.symbol}</span><span className="pf-up">{(topGainer.change24h ?? 0) >= 0 ? "+" : ""}{fmt(topGainer.change24h, 1)}%</span></div>
                )}
                {topLoser && topLoser.symbol !== topGainer?.symbol && (
                  <div className="pf-mover"><TrendingDown className="size-4 pf-dn" /><span className="pf-moversym">{topLoser.symbol}</span><span className="pf-dn">{fmt(topLoser.change24h, 1)}%</span></div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="pf-addform">
              <div className="pf-symsearch">
                <Search className="size-3.5 pf-symsearchico" />
                <input value={form.symbol} onChange={(e) => onSymbol(e.target.value)} placeholder="Search symbol — BTC, Apple, RELIANCE…" autoComplete="off" />
                {searching && <Loader2 className="size-3.5 animate-spin pf-symsearchspin" />}
                {hits.length > 0 && (
                  <div className="pf-symresults">
                    {hits.map((h) => (
                      <button key={h.symbol} type="button" onClick={() => pickHit(h)} className="pf-symhit">
                        <span className="pf-symhitsym">{h.symbol}</span>
                        <span className="pf-symhitname">{h.name}</span>
                        <span className="pf-symhitex">{h.kind === "crypto" ? "crypto" : h.exchange || "stock"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                  <button onClick={() => trackInMarkets(p)} title={tracked.has(p.id) ? "Tracking in Markets" : "Track in Markets"} className={cn(tracked.has(p.id) && "pf-tracked")}><CandlestickChart className="size-3.5" /></button>
                  <button onClick={() => explain(p)} title="Explain this ticker"><Info className="size-3.5" /></button>
                  <button onClick={() => checkThesis(p)} disabled={!p.thesis} title={p.thesis ? "Stress-test my thesis" : "Write a thesis first"}><Gavel className="size-3.5" /></button>
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
              {insight[p.id] && (
                <div className={cn("pf-insight", insight[p.id].verdict)}>
                  {insight[p.id].loading ? (
                    <><Loader2 className="size-3.5 animate-spin" /> {insight[p.id].kind === "thesis" ? "Stress-testing your thesis…" : "Reading up on it…"}</>
                  ) : (
                    <>
                      {insight[p.id].verdict && <span className="pf-verdict">{insight[p.id].verdict}</span>}
                      <span>{insight[p.id].text}</span>
                      <button onClick={() => setInsight((s) => { const n = { ...s }; delete n[p.id]; return n; })} className="pf-insightx"><X className="size-3" /></button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {positions && positions.length === 0 && (
          <div className="cc-zero"><Wallet className="size-6 opacity-40" /><p>No holdings yet. Add your crypto &amp; stocks to track live P&amp;L and link the news to your positions.</p></div>
        )}
      </div>

      {/* ── analysis: curve, risk, trades, alerts ── */}
      <EquityPanel />
      <RiskPanel reloadKey={analysisKey} />
      <AttributionPanel reloadKey={analysisKey} />
      <TradesPanel onChange={() => setAnalysisKey((k) => k + 1)} />
      <AlertsPanel />

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

      {/* Expenses & subscriptions */}
      <div className="pf-exp">
        <div className="cc-head" style={{ margin: "6px 0 12px" }}>
          <div className="sectitle" style={{ marginBottom: 0 }}><span className="sn"><Receipt className="size-3.5" /></span><h2 style={{ fontSize: 15 }}>Expenses</h2><span className="line" />{summary && <span className="tag">{inr(summary.total)} / 30D</span>}</div>
          <button onClick={scanReceipts} disabled={scanning} className="cc-btn cc-scan">{scanning ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Scan receipts</button>
        </div>

        {summary && Object.keys(summary.byCategory).length > 0 && (
          <div className="pf-cats">
            {Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
              <div key={c} className="pf-cat">
                <div className="pf-catbar"><span style={{ width: `${Math.min(100, (v / (summary.total || 1)) * 100)}%` }} /></div>
                <span className="pf-catlbl">{c}</span><span className="pf-catv">{inr(v)}</span>
              </div>
            ))}
          </div>
        )}

        {summary && summary.recurring.length > 0 && (
          <div className="pf-subs">
            <span className="lbl !text-[9px]">SUBSCRIPTIONS</span>
            <div className="pf-subrow">{summary.recurring.map((s, i) => <span key={i} className="pf-sub">{s.merchant} · {inr(s.amount)}</span>)}</div>
          </div>
        )}

        <div className="pf-addform" style={{ marginTop: 12 }}>
          <input value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} placeholder="₹ amount" type="number" />
          <input value={exp.merchant} onChange={(e) => setExp({ ...exp, merchant: e.target.value })} placeholder="Merchant" onKeyDown={(e) => e.key === "Enter" && addExp()} />
          <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <button onClick={addExp} className="cc-btn cc-scan"><Plus className="size-3.5" /> Add</button>
        </div>

        {expenses.length > 0 && (
          <div className="pf-explist">
            {expenses.slice(0, 12).map((e) => (
              <div key={e.id} className="pf-exprow">
                <span className="pf-expm">{e.merchant}{e.recurring && <i> · sub</i>}</span>
                <span className="pf-expc">{e.category}</span>
                <span className="pf-expd">{new Date(e.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                <span className="pf-expa">{inr(e.amount)}</span>
                <button onClick={() => delExp(e.id)} className="cc-del" title="Remove"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Financial mentor */}
      <div className="pf-mentor">
        <div className="sectitle" style={{ margin: "6px 0 12px" }}><span className="sn"><Sparkles className="size-3.5" /></span><h2 style={{ fontSize: 15 }}>Financial Mentor</h2><span className="line" /></div>
        <div className="pf-mentorbox">
          <div className="pf-mentorask">
            <input value={mentorQ} onChange={(e) => setMentorQ(e.target.value)} placeholder="Ask about your money — 'am I overspending?', 'should I rebalance?'…" onKeyDown={(e) => e.key === "Enter" && mentorQ.trim() && askMentor()} />
            <button onClick={() => askMentor()} disabled={mentorBusy || !mentorQ.trim()} className="cc-btn cc-scan">{mentorBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}</button>
          </div>
          <button onClick={() => askMentor("Give me my monthly financial read")} disabled={mentorBusy} className="pf-mentorquick">{mentorBusy ? "Thinking…" : "Get my monthly read →"}</button>
          {mentorA && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pf-mentorans">{mentorA}</motion.div>}
        </div>
      </div>
    </div>
  );
}
