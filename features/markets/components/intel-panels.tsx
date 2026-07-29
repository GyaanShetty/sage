"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Newspaper, Gauge, Grid3x3, CalendarClock, Network, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import "./intel.css";

const pct = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

/* ── AI daily market read ─────────────────────────────────── */

export function NarrativePanel() {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [cached, setCached] = useState(false);

  const load = useCallback((refresh = false) => {
    setBusy(true);
    fetch(`/api/market/narrative${refresh ? "?refresh=1" : ""}`)
      .then((r) => r.json())
      .then((j) => { setText(j?.data?.narrative ?? null); setCached(!!j?.data?.cached); })
      .catch(() => setText(null))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mk-card">
      <div className="mk-head">
        <Newspaper className="size-3.5" /><h3>TODAY&rsquo;S READ</h3><span className="mk-line" />
        {cached && <span className="mk-tag">CACHED</span>}
        <button onClick={() => load(true)} disabled={busy} className="mk-btn">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} REFRESH
        </button>
      </div>
      {busy && !text && <p className="mk-dim">SAGE is reading the tape…</p>}
      {text && <div className="mk-prose">{text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>}
      {!busy && !text && <p className="mk-dim">No read available — the model is unreachable right now.</p>}
    </div>
  );
}

/* ── fear & greed + sector heatmap ────────────────────────── */

interface Sentiment { value: number; label: string; delta: number; history: { at: string; value: number }[] }
interface Sector { symbol: string; label: string; region: "IN" | "US"; changePct: number | null }
interface SectorData { sectors: Sector[]; leaders: Sector[]; laggards: Sector[]; breadth: number | null }

export function PulsePanel() {
  const [s, setS] = useState<Sentiment | null>(null);
  const [sec, setSec] = useState<SectorData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/market/sentiment").then((r) => r.json()).then((j) => setS(j?.data ?? null)).catch(() => {}),
      fetch("/api/market/sectors").then((r) => r.json()).then((j) => setSec(j?.data ?? null)).catch(() => {}),
    ]).finally(() => setLoaded(true));
  }, []);

  const heat = (v: number | null) => {
    if (v == null) return "rgba(255,255,255,.05)";
    const m = Math.min(1, Math.abs(v) / 2.5);
    return v >= 0 ? `rgba(52,211,153,${0.1 + m * 0.5})` : `rgba(248,113,113,${0.1 + m * 0.5})`;
  };

  return (
    <div className="mk-grid2">
      <div className="mk-card">
        <div className="mk-head"><Gauge className="size-3.5" /><h3>FEAR &amp; GREED</h3><span className="mk-line" /></div>
        {s ? (
          <div className="mk-fng">
            <Dial value={s.value} />
            <div className="mk-fngmeta">
              <span className="mk-fnglabel">{s.label.toUpperCase()}</span>
              <span className={cn("mk-fngdelta", s.delta >= 0 ? "up-txt" : "dn-txt")}>
                {s.delta >= 0 ? "▲" : "▽"} {Math.abs(s.delta)} vs last week
              </span>
              <div className="mk-spark">
                {s.history.map((h, i) => (
                  <span key={i} style={{ height: `${Math.max(6, h.value)}%` }} title={`${h.at}: ${h.value}`} />
                ))}
              </div>
            </div>
          </div>
        ) : <p className="mk-dim">{loaded ? "Sentiment feed unavailable." : "loading…"}</p>}
      </div>

      <div className="mk-card">
        <div className="mk-head">
          <Grid3x3 className="size-3.5" /><h3>SECTORS</h3><span className="mk-line" />
          {sec?.breadth != null && <span className="mk-tag">{sec.breadth.toFixed(0)}% GREEN</span>}
        </div>
        {sec?.sectors?.length ? (
          <div className="mk-heat">
            {sec.sectors.map((x) => (
              <div key={x.symbol} className="mk-heatcell" style={{ background: heat(x.changePct) }} title={`${x.label} · ${pct(x.changePct)}`}>
                <span className="mk-heatlbl">{x.label}</span>
                <span className="mk-heatval">{pct(x.changePct, 1)}</span>
                <i className="mk-heatreg">{x.region}</i>
              </div>
            ))}
          </div>
        ) : <p className="mk-dim">{loaded ? "Sector feed unavailable." : "loading…"}</p>}
      </div>
    </div>
  );
}

/** Semicircular 0–100 dial. */
function Dial({ value }: { value: number }) {
  const r = 40, cx = 48, cy = 48;
  const a = Math.PI * (1 - value / 100);
  const x = cx + Math.cos(a) * r, y = cy - Math.sin(a) * r;
  const col = value < 25 ? "#f87171" : value < 45 ? "#fb923c" : value < 55 ? "#facc15" : value < 75 ? "#a3e635" : "#34d399";
  return (
    <svg viewBox="0 0 96 58" className="mk-dial">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="7" strokeLinecap="round" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}`} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round" />
      <text x={cx} y={cy - 6} textAnchor="middle" className="mk-dialval" fill={col}>{value}</text>
    </svg>
  );
}

/* ── upcoming events + correlation matrix ─────────────────── */

interface CalEvent { date: string; title: string; category: string; importance: string; why: string }
interface Corr { symbols: string[]; matrix: number[][]; days: number; mostCorrelated: { a: string; b: string; r: number }[] }

export function EventsCorrelationPanel({ symbols }: { symbols: string[] }) {
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [c, setC] = useState<Corr | null>(null);
  const [corrBusy, setCorrBusy] = useState(false);

  useEffect(() => {
    fetch("/api/market/calendar").then((r) => r.json()).then((j) => setEvents(j?.data?.events ?? [])).catch(() => setEvents([]));
  }, []);

  const picked = symbols.slice(0, 6);
  const loadCorr = useCallback(() => {
    if (picked.length < 2) return;
    setCorrBusy(true);
    fetch(`/api/market/correlation?symbols=${encodeURIComponent(picked.join(","))}`)
      .then((r) => r.json()).then((j) => setC(j?.ok ? j.data : null)).catch(() => setC(null))
      .finally(() => setCorrBusy(false));
  }, [picked.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const cell = (v: number) => {
    const m = Math.min(1, Math.abs(v));
    return v >= 0 ? `rgba(255, 255, 255,${0.08 + m * 0.6})` : `rgba(248,113,113,${0.08 + m * 0.6})`;
  };

  return (
    <div className="mk-grid2">
      <div className="mk-card">
        <div className="mk-head"><CalendarClock className="size-3.5" /><h3>UPCOMING</h3><span className="mk-line" /></div>
        {events === null && <p className="mk-dim">loading…</p>}
        {events?.length ? (
          <div className="mk-events">
            {events.slice(0, 6).map((e, i) => (
              <div key={i} className={cn("mk-event", `imp-${e.importance}`)}>
                <span className="mk-evdate">{e.date.slice(5)}</span>
                <div className="mk-evbody">
                  <span className="mk-evtitle">{e.title}</span>
                  <span className="mk-evwhy">{e.why}</span>
                </div>
              </div>
            ))}
          </div>
        ) : events && <p className="mk-dim">No dated events found in today&rsquo;s headlines.</p>}
      </div>

      <div className="mk-card">
        <div className="mk-head">
          <Network className="size-3.5" /><h3>CORRELATION</h3><span className="mk-line" />
          <button onClick={loadCorr} disabled={corrBusy || picked.length < 2} className="mk-btn">
            {corrBusy ? <Loader2 className="size-3 animate-spin" /> : <Network className="size-3" />} RUN
          </button>
        </div>
        {picked.length < 2 && <p className="mk-dim">Add at least two tickers to your watchlist.</p>}
        {picked.length >= 2 && !c && !corrBusy && (
          <p className="mk-dim">See which of your names actually move together — where you think you&rsquo;re diversified but aren&rsquo;t.</p>
        )}
        {c && (
          <>
            <div className="mk-matrix" style={{ gridTemplateColumns: `56px repeat(${c.symbols.length}, 1fr)` }}>
              <span />
              {c.symbols.map((s) => <span key={s} className="mk-mhead">{s.replace(/\.(NS|BO)$/, "").slice(0, 5)}</span>)}
              {c.symbols.map((row, i) => (
                <Fragment key={row}>
                  <span className="mk-mhead left">{row.replace(/\.(NS|BO)$/, "").slice(0, 5)}</span>
                  {c.matrix[i].map((v, j) => (
                    <span key={`${i}-${j}`} className="mk-mcell" style={{ background: i === j ? "rgba(255,255,255,.1)" : cell(v) }} title={`${c.symbols[i]} vs ${c.symbols[j]}: ${v}`}>
                      {v.toFixed(1)}
                    </span>
                  ))}
                </Fragment>
              ))}
            </div>
            {c.mostCorrelated[0] && (
              <p className="mk-dim" style={{ marginTop: 9 }}>
                Tightest pair: <b>{c.mostCorrelated[0].a}</b> and <b>{c.mostCorrelated[0].b}</b> at r={c.mostCorrelated[0].r.toFixed(2)} over {c.days} days.
                {Math.abs(c.mostCorrelated[0].r) > 0.8 && " Effectively the same bet."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
