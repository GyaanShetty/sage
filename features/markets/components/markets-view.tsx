"use client";

import { useCallback, useEffect, useState } from "react";
import { NarrativePanel, PulsePanel, EventsCorrelationPanel } from "./intel-panels";
import "@/features/dashboard/command.css";
import "@/features/dashboard/wall.css";
import { Pane, Row, Stat, Empty } from "@/components/pane";
import { Progress } from "@/components/instruments";
import { NumberTicker } from "@/components/number-ticker";
import { asArray } from "@/lib/as-array";

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
      .then((r) => r.json()).then((j) => setIndices(asArray(j.data))).catch(() => setIndices([]));
    fetch(`/api/market/quotes?symbols=${encodeURIComponent(c.stocks.join(","))}`)
      .then((r) => r.json()).then((j) => setStocks(asArray(j.data))).catch(() => setStocks([]));
    fetch(`/api/markets?ids=${encodeURIComponent(c.crypto.join(","))}`)
      .then((r) => r.json()).then((j) => setCoins(asArray(j.data))).catch(() => setCoins([]));
    fetch("/api/fx").then((r) => r.json()).then((j) => setFx(asArray(j.data))).catch(() => setFx([]));
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

  // one-tap add of a watchlist name into the portfolio (markets → portfolio link)
  const [added, setAdded] = useState<Set<string>>(new Set());
  const addToPortfolio = async (symbol: string, kind: "crypto" | "stock") => {
    setAdded((s) => new Set(s).add(symbol));
    await fetch("/api/portfolio", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol, kind, qty: 0, avgCost: 0 }),
    }).catch(() => {});
    window.dispatchEvent(new CustomEvent("sage:toast", {
      detail: { title: "ADDED TO PORTFOLIO", body: `${symbol} — set quantity and cost in Portfolio.` },
    }));
  };

  /**
   * Movers and breadth, derived rather than fetched.
   *
   * Both are functions of the quotes already on screen, so they cost nothing
   * upstream — which matters on a free tier, and matters more because a
   * "movers" pane that disagreed with the watchlist beside it would be worse
   * than no movers pane at all.
   */
  const universe = [
    ...(stocks ?? []).map((q) => ({ sym: q.symbol.replace(/\.(NS|BO)$/, ""), pct: q.changePct })),
    ...(coins ?? []).map((c) => ({ sym: c.symbol, pct: c.change24h })),
  ].filter((x) => Number.isFinite(x.pct));

  const movers = [...universe].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const up = universe.filter((x) => x.pct > 0).length;
  const down = universe.filter((x) => x.pct < 0).length;
  const flat = universe.length - up - down;

  return (
    <div className="wall">
      {/* ── ROW 1 · PRICES ───────────────────────────────────────────────── */}
      <div className="wall-row wall3-r1">
        <Pane
          n={1}
          title="Indices"
          status={
            <span className="fc-btns">
              <button onClick={() => setCustomize((c) => !c)}>{customize ? "DONE" : "CUSTOMIZE"}</button>
            </span>
          }
          live={!!indices?.length}
        >
          {indices === null && <div className="tile-wait">ACQUIRING…</div>}
          {(indices ?? []).map((q) => (
            <div className="tstat" key={q.symbol}>
              <span className="tstat-v num">
                <NumberTicker value={q.price} format={(v) => fmtPx(v, q.currency)} />
              </span>
              <span className="tstat-k">
                {q.name} <span className={q.changePct >= 0 ? "up-txt" : "dn-txt"}>
                  {q.changePct >= 0 ? "▲" : "▽"} {Math.abs(q.changePct).toFixed(2)}%
                </span>
              </span>
            </div>
          ))}
          {customize && (
            <>
              <div className="tile-cap">YAHOO SYMBOLS · ^NSEI ^BSESN ^GSPC</div>
              <Editor items={cfg.indices} onChange={(v) => save({ ...cfg, indices: v })} placeholder="add index…" />
            </>
          )}
        </Pane>

        <Pane n={2} title="Watchlist" status="YAHOO · 5M" live={!!stocks?.length}>
          {customize && (
            <>
              <div className="tile-cap">NSE RELIANCE.NS · BSE 500325.BO · US NVDA</div>
              <Editor items={cfg.stocks} onChange={(v) => save({ ...cfg, stocks: v })} placeholder="add ticker…" />
            </>
          )}
          {stocks === null && <div className="tile-wait">ACQUIRING…</div>}
          {stocks?.map((q) => (
            <div className="mkt" key={q.symbol}>
              <span className="sym">{q.symbol.replace(/\.(NS|BO)$/, "")}</span>
              <Spark data={q.spark} up={q.changePct >= 0} />
              <span className="px">{fmtPx(q.price, q.currency)}</span>
              <span className={`chg${q.changePct >= 0 ? " up" : ""}`}>
                {q.changePct >= 0 ? "▲" : "▽"} {Math.abs(q.changePct).toFixed(1)}%
              </span>
              <button
                className="mkt-add"
                title={added.has(q.symbol) ? "Added to portfolio" : "Add to portfolio"}
                disabled={added.has(q.symbol)}
                onClick={() => addToPortfolio(q.symbol, "stock")}
              >{added.has(q.symbol) ? "✓" : "+"}</button>
            </div>
          ))}
        </Pane>

        <div className="wall-stack">
          <Pane n={3} title="Crypto" status="CG · USD" live={!!coins?.length}>
            {customize && (
              <>
                <div className="tile-cap">COINGECKO IDS · bitcoin ethereum</div>
                <Editor items={cfg.crypto} onChange={(v) => save({ ...cfg, crypto: v })} placeholder="add coin id…" />
              </>
            )}
            {coins === null && <div className="tile-wait">ACQUIRING…</div>}
            {coins?.map((c) => (
              <div className="mkt" key={c.symbol}>
                <span className="sym">{c.symbol}</span>
                <Spark data={c.spark} up={c.change24h >= 0} />
                <span className="px">${c.price >= 1000 ? Math.round(c.price).toLocaleString() : c.price.toFixed(2)}</span>
                <span className={`chg${c.change24h >= 0 ? " up" : ""}`}>
                  {c.change24h >= 0 ? "▲" : "▽"} {Math.abs(c.change24h).toFixed(1)}%
                </span>
              </div>
            ))}
          </Pane>

          <Pane n={4} title="Currency" status="ECB · PER INR" live={!!fx?.length}>
            {fx === null && <div className="tile-wait">ACQUIRING…</div>}
            {fx?.map((f) => (
              <Row key={f.pair} k={f.pair} v={`₹${f.rate.toFixed(2)}`} />
            ))}
          </Pane>
        </div>

        {/* Movers reads absolute move, so the worst faller ranks with the best
            riser. A "top movers" list sorted by signed change is a top gainers
            list wearing the wrong label. */}
        <Pane n={5} title="Movers" status="BY ABSOLUTE MOVE" live={movers.length > 0}>
          {universe.length === 0 && <div className="tile-wait">ACQUIRING…</div>}
          {movers.slice(0, 8).map((m) => (
            <Row
              key={m.sym}
              k={m.sym}
              v={`${m.pct >= 0 ? "▲" : "▽"}${Math.abs(m.pct).toFixed(1)}%`}
              tone={m.pct >= 0 ? "up" : "down"}
            />
          ))}
        </Pane>
      </div>

      {/* ── ROW 2 · INTELLIGENCE ─────────────────────────────────────────── */}
      <div className="wall-row wall3-r2">
        <div className="wall-cell"><NarrativePanel /></div>
        <div className="wall-cell"><PulsePanel /></div>
        <div className="wall-cell"><EventsCorrelationPanel symbols={[...cfg.indices, ...cfg.stocks]} /></div>

        <Pane n={9} title="Breadth" status={`${universe.length} NAMES`} live={universe.length > 0}>
          {universe.length === 0 && <div className="tile-wait">ACQUIRING…</div>}
          {universe.length > 0 && (
            <>
              <div className="km">
                <Stat v={String(up)} k="Advancing" tone="up" />
                <Stat v={String(down)} k="Declining" tone="down" />
                <Stat v={String(flat)} k="Flat" />
              </div>
              {/* The ratio, not the counts, is what says whether a green index
                  is broad or is three names carrying everything. */}
              <Progress
                pct={universe.length ? up / universe.length : 0}
                left={`${Math.round((up / Math.max(universe.length, 1)) * 100)}% UP`}
                right={`${Math.round((down / Math.max(universe.length, 1)) * 100)}% DOWN`}
              />
            </>
          )}
        </Pane>
      </div>

      {/* ── ROW 3 · DESK ─────────────────────────────────────────────────── */}
      <div className="wall-row wall3-r3">
        <Pane n={10} title="Desk Brief" status="AI · 2×/DAY" live={!!analysis}>
          {analysisLoading && <div className="tile-wait">COMPILING…</div>}
          {!analysisLoading && !analysis && (
            <Empty reason="No brief filed yet" action="The desk files twice a day" />
          )}
          {analysis && <div className="mkta-text">{analysis}</div>}
        </Pane>

        {cfg.streams.map((f, i) => (
          <Pane
            key={`${f.id}-${i}`}
            n={11 + i}
            title={f.label}
            className="mk-tv"
            status={
              <span className="fc-btns">
                <button onClick={() => { setEditingStream(editingStream === i ? null : i); setStreamDraft(""); }}>
                  {editingStream === i ? "CANCEL" : "SWAP"}
                </button>
              </span>
            }
            live={playing[i]}
          >
            {editingStream === i ? (
              <div className="notein" style={{ marginBottom: 0 }}>
                <input
                  autoFocus
                  value={streamDraft}
                  onChange={(e) => setStreamDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyStream(i)}
                  placeholder="Paste any YouTube link…"
                />
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
              /* Poster until asked. Two autoplaying embeds on a screen that is
                 open all day is a lot of bandwidth for something nobody is
                 listening to. */
              <button
                className="stream-frame stream-poster"
                style={{ backgroundImage: `url(https://i.ytimg.com/vi/${f.id}/hqdefault.jpg)` }}
                onClick={() => setPlaying((p) => p.map((v, j) => (j === i ? true : v)))}
                aria-label={`Play ${f.label}`}
              >
                <span className="stream-play">▶ ENGAGE</span>
              </button>
            )}
          </Pane>
        ))}
      </div>
    </div>
  );
}
