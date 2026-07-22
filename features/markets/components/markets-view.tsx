"use client";

import { useCallback, useEffect, useState } from "react";
import "@/features/dashboard/command.css";
import { NumberTicker } from "@/components/number-ticker";

interface Quote { symbol: string; name: string; price: number; change: number; changePct: number; currency: string; spark: number[] }
interface Coin { symbol: string; name: string; price: number; change24h: number; spark: number[] }
interface Fx { pair: string; rate: number }
interface Feed { label: string; id: string }

interface Config {
  indices: string[];
  stocks: string[];
  crypto: string[];
  streams: Feed[];
}

const DEFAULTS: Config = {
  indices: ["^NSEI", "^BSESN"],
  stocks: ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "NVDA", "AAPL"],
  crypto: ["bitcoin", "ethereum", "solana", "chainlink"],
  streams: [
    { label: "CNBC-TV18", id: "5uAdjWBsCLE" },
    { label: "BLOOMBERG", id: "iEpJwprxDdk" },
  ],
};

const LS_KEY = "sage-market-config";

function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (!data.length) return <svg viewBox="0 0 100 21" />;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${19 - ((v - min) / rng) * 17}`).join(" ");
  return (
    <svg viewBox="0 0 100 21" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? "#f4f4f5" : "#5c5c62"} strokeWidth="1" />
    </svg>
  );
}

function fmtPx(v: number, ccy: string) {
  const s = v >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(2);
  return ccy === "INR" ? `₹${s}` : ccy === "USD" ? `$${s}` : s;
}

function parseYoutube(input: string): string | null {
  const m =
    input.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/) ??
    input.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}

/** Inline symbol editor: chips with ✕, plus an add box. */
function Editor({ items, onChange, placeholder }: { items: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft("");
  };
  return (
    <div className="wl-editor">
      {items.map((s) => (
        <span className="wl-chip" key={s}>
          {s}
          <button onClick={() => onChange(items.filter((x) => x !== s))} aria-label={`remove ${s}`}>✕</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder={placeholder}
      />
    </div>
  );
}

export function MarketsView() {
  const [cfg, setCfg] = useState<Config>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [indices, setIndices] = useState<Quote[] | null>(null);
  const [stocks, setStocks] = useState<Quote[] | null>(null);
  const [coins, setCoins] = useState<Coin[] | null>(null);
  const [fx, setFx] = useState<Fx[] | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [customize, setCustomize] = useState(false);
  const [playing, setPlaying] = useState<boolean[]>([]);
  const [editingStream, setEditingStream] = useState<number | null>(null);
  const [streamDraft, setStreamDraft] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setCfg({ ...DEFAULTS, ...(JSON.parse(saved) as Partial<Config>) });
    } catch {}
    setLoaded(true);
  }, []);

  const save = useCallback((next: Config) => {
    setCfg(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  }, []);

  const refresh = useCallback((c: Config) => {
    fetch(`/api/market/quotes?symbols=${encodeURIComponent(c.indices.join(","))}`)
      .then((r) => r.json()).then((j) => setIndices(j.data ?? [])).catch(() => setIndices([]));
    fetch(`/api/market/quotes?symbols=${encodeURIComponent(c.stocks.join(","))}`)
      .then((r) => r.json()).then((j) => setStocks(j.data ?? [])).catch(() => setStocks([]));
    fetch(`/api/markets?ids=${encodeURIComponent(c.crypto.join(","))}`)
      .then((r) => r.json()).then((j) => setCoins(j.data ?? [])).catch(() => setCoins([]));
    fetch("/api/fx").then((r) => r.json()).then((j) => setFx(j.data ?? [])).catch(() => setFx([]));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    refresh(cfg);
    const t = setInterval(() => refresh(cfg), 120000);
    return () => clearInterval(t);
  }, [loaded, cfg, refresh]);

  useEffect(() => {
    if (!loaded) return;
    setAnalysisLoading(true);
    fetch(`/api/market/analysis?symbols=${encodeURIComponent([...cfg.indices, ...cfg.stocks].join(","))}`)
      .then((r) => r.json())
      .then((j) => setAnalysis(j.data ?? null))
      .catch(() => setAnalysis(null))
      .finally(() => setAnalysisLoading(false));
    // analysis is cached server-side per half-day; config edits shouldn't refire it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => setPlaying(cfg.streams.map(() => false)), [cfg.streams]);

  const applyStream = (i: number) => {
    const id = parseYoutube(streamDraft.trim());
    if (id) {
      save({ ...cfg, streams: cfg.streams.map((f, j) => (j === i ? { label: `FEED ${i + 1}`, id } : f)) });
    }
    setEditingStream(null);
    setStreamDraft("");
  };

  return (
    <div>
      <section className="section" id="markets">
        <div className="sectitle">
          <span className="sn">MKT</span><h2>Markets</h2><span className="line" />
          <button className="chip" onClick={() => setCustomize((c) => !c)} style={{ marginLeft: "auto" }}>
            {customize ? "DONE" : "CUSTOMIZE"}
          </button>
        </div>

        {/* indices strip */}
        <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(indices?.length ?? cfg.indices.length, 1)}, 1fr)`, marginBottom: 1 }}>
          {(indices ?? []).map((q) => (
            <div className="cell ct" key={q.symbol}>
              <div className="cv num"><NumberTicker value={q.price} format={(v) => fmtPx(v, q.currency)} /></div>
              <div className="ck">{q.name} <span className={q.changePct >= 0 ? "up-txt" : "dn-txt"}>{q.changePct >= 0 ? "▲" : "▽"} {Math.abs(q.changePct).toFixed(2)}%</span></div>
            </div>
          ))}
          {indices === null && <div className="cell"><p className="lbl">LOADING INDICES…</p></div>}
        </div>
        {customize && (
          <div className="cell" style={{ marginBottom: 1 }}>
            <p className="lbl" style={{ marginBottom: 6 }}>INDICES · YAHOO SYMBOLS (^NSEI, ^BSESN, ^GSPC, ^IXIC…)</p>
            <Editor items={cfg.indices} onChange={(v) => save({ ...cfg, indices: v })} placeholder="add index…" />
          </div>
        )}

        <div className="grid deckmkt">
          {/* watchlist */}
          <div className="cell">
            <div className="bh"><span className="t">Watchlist</span><span className="i">EQ</span><span className="r">YAHOO · 5M CACHE</span></div>
            {customize && (
              <>
                <p className="lbl" style={{ margin: "4px 0 6px" }}>NSE: RELIANCE.NS · BSE: 500325.BO · US: NVDA</p>
                <Editor items={cfg.stocks} onChange={(v) => save({ ...cfg, stocks: v })} placeholder="add ticker…" />
              </>
            )}
            {stocks === null && <p className="lbl">LOADING…</p>}
            {stocks?.map((q) => (
              <div className="mkt" key={q.symbol}>
                <span className="sym" style={{ width: 92, flex: "0 0 92px" }}>{q.symbol.replace(/\.(NS|BO)$/, "")}</span>
                <Spark data={q.spark} up={q.changePct >= 0} />
                <span className="px">{fmtPx(q.price, q.currency)}</span>
                <span className={`chg${q.changePct >= 0 ? " up" : ""}`}>{q.changePct >= 0 ? "▲" : "▽"} {Math.abs(q.changePct).toFixed(1)}%</span>
              </div>
            ))}
          </div>

          {/* crypto + fx */}
          <div className="stack">
            <div className="cell">
              <div className="bh"><span className="t">Crypto</span><span className="i">CG</span><span className="r">USD · LIVE</span></div>
              {customize && (
                <>
                  <p className="lbl" style={{ margin: "4px 0 6px" }}>COINGECKO IDS: bitcoin · ethereum · dogecoin…</p>
                  <Editor items={cfg.crypto} onChange={(v) => save({ ...cfg, crypto: v })} placeholder="add coin id…" />
                </>
              )}
              {coins === null && <p className="lbl">LOADING…</p>}
              {coins?.map((c) => (
                <div className="mkt" key={c.symbol}>
                  <span className="sym">{c.symbol}</span>
                  <Spark data={c.spark} up={c.change24h >= 0} />
                  <span className="px">${c.price >= 1000 ? Math.round(c.price).toLocaleString() : c.price.toFixed(2)}</span>
                  <span className={`chg${c.change24h >= 0 ? " up" : ""}`}>{c.change24h >= 0 ? "▲" : "▽"} {Math.abs(c.change24h).toFixed(1)}%</span>
                </div>
              ))}
            </div>
            <div className="cell" style={{ flex: 1 }}>
              <div className="bh"><span className="t">Currency</span><span className="i">ECB</span><span className="r">PER INR</span></div>
              {fx?.map((f) => (
                <div className="mkt" key={f.pair}>
                  <span className="sym" style={{ flex: 1, width: "auto" }}>{f.pair}</span>
                  <span className="px">₹{f.rate.toFixed(2)}</span>
                  <span className="chg">{f.pair.startsWith("JPY") ? "PER 100" : ""}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI analysis */}
          <div className="cell mkta">
            <div className="bh"><span className="t">Analysis</span><span className="i">AI</span><span className="r">DESK BRIEF · 2×/DAY</span></div>
            {analysisLoading && <p className="lbl">COMPILING BRIEF…</p>}
            {!analysisLoading && !analysis && (
              <div className="empty-state"><div className="es-t">NO BRIEF YET</div><div className="es-d">The desk files twice a day — check back shortly.</div></div>
            )}
            {analysis && <div className="mkta-text">{analysis}</div>}
          </div>
        </div>

        {/* market TV */}
        <div className="grid streams-grid" style={{ marginTop: 1 }}>
          {cfg.streams.map((f, i) => (
            <div className="cell stream-cell" key={`${f.id}-${i}`}>
              <div className="bh" style={{ marginBottom: 8 }}>
                <span className="t" style={{ fontSize: 10 }}>{f.label}</span>
                <span className="i">TV</span>
                <button className="stream-swap" onClick={() => { setEditingStream(editingStream === i ? null : i); setStreamDraft(""); }}>
                  {editingStream === i ? "CANCEL" : "SWAP"}
                </button>
              </div>
              {editingStream === i ? (
                <div className="notein" style={{ marginBottom: 0 }}>
                  <input autoFocus value={streamDraft} onChange={(e) => setStreamDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyStream(i)} placeholder="Paste any YouTube link…" />
                  <button onClick={() => applyStream(i)}>SET</button>
                </div>
              ) : playing[i] ? (
                <div className="stream-frame">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${f.id}?autoplay=1&mute=1`}
                    title={f.label}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                  />
                </div>
              ) : (
                <button
                  className="stream-frame stream-poster"
                  style={{ backgroundImage: `url(https://i.ytimg.com/vi/${f.id}/hqdefault.jpg)` }}
                  onClick={() => setPlaying((p) => p.map((v, j) => (j === i ? true : v)))}
                  aria-label={`Play ${f.label}`}
                >
                  <span className="stream-play">▶ ENGAGE</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
