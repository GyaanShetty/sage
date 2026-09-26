"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Newspaper, Gauge, Grid3x3, CalendarClock, Network, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import "./intel.css";

/**
 * A request that is allowed to give up.
 *
 * These four panels each call an endpoint that ends in a model call, and none
 * of them had a deadline. When one of those functions ran past the platform's
 * limit the browser was left holding a request that would never settle, so
 * UPCOMING sat on "loading…" for the rest of the session — not failed, not
 * empty, just permanently loading, which is the one state a panel cannot
 * recover from on its own.
 *
 * Twenty-five seconds is generous for a model call and finite, which is the
 * only property that matters here.
 */
async function withDeadline<T>(url: string, ms = 25_000): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const pct = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

/* ── AI daily market read ─────────────────────────────────── */

export function NarrativePanel() {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [cached, setCached] = useState(false);

  const [failed, setFailed] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    const j = await withDeadline<{ data?: { narrative?: string; cached?: boolean } }>(
      `/api/market/narrative${refresh ? "?refresh=1" : ""}`,
    );
    setBusy(false);
    if (!j) { setFailed(true); return; }   // keep whatever is on screen
    setFailed(false);
    setText(j.data?.narrative ?? null);
    setCached(!!j.data?.cached);
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
      {busy && !text && <p className="mk-dim">SAGE is reading the tape — this is a model call, so give it a moment…</p>}
      {failed && <p className="mk-dim">Couldn&rsquo;t finish reading the tape. {text ? "Showing the last read." : ""} <button onClick={() => load(true)} className="mk-btn">RETRY</button></p>}
      {text && <div className="mk-prose">{text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>}
      {!busy && !failed && !text && <p className="mk-dim">No read available — the model is unreachable right now.</p>}
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
      withDeadline<{ data?: Sentiment }>("/api/market/sentiment").then((j) => setS(j?.data ?? null)),
      withDeadline<{ data?: SectorData }>("/api/market/sectors").then((j) => setSec(j?.data ?? null)),
    ]).finally(() => setLoaded(true));
  }, []);

  /*
   * Tint, not fill.
   *
   * These were saturated slabs at up to 60% alpha — the loudest thing in the
   * whole application, so a routine -2.3% in IT shouted over every genuine
   * alert on the page. Nothing about a sector list is urgent.
   *
   * And a filled rectangle encodes magnitude as colour intensity, which the
   * eye reads far less precisely than length. So the tint says direction only,
   * capped where it stays background, and the size moves to a bar (below)
   * where it can actually be compared between rows.
   */
  const heat = (v: number | null) => {
    if (v == null) return "rgba(255,255,255,.03)";
    return v >= 0 ? "rgba(95,185,138,.10)" : "rgba(226,140,147,.10)";
  };

  /** How far the magnitude bar runs, as a percentage. 2.5% of move is full. */
  const mag = (v: number | null) => (v == null ? 0 : Math.min(1, Math.abs(v) / 2.5) * 100);

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
              <div
                key={x.symbol}
                className={`mk-heatcell${x.changePct == null ? "" : x.changePct >= 0 ? " up" : " down"}`}
                style={{ background: heat(x.changePct) }}
                title={`${x.label} · ${pct(x.changePct)}`}
              >
                <span className="mk-heatlbl">{x.label}</span>
                <span className="mk-heatval">{pct(x.changePct, 1)}</span>
                <i className="mk-heatreg">{x.region}</i>
                {/* The magnitude, as a length you can compare down the column. */}
                <span className="mk-heatbar" style={{ width: `${mag(x.changePct)}%` }} />
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
  /*
   * Two colours and a neutral, not five.
   *
   * This ran a full rainbow — red, orange, yellow, lime, green — across a dial
   * whose only job is "fearful, neutral or greedy". Five hues on one gauge in
   * an interface that otherwise has one accent read as a children's toy, and
   * the middle three were indistinguishable at 96px anyway.
   */
  const col = value < 40 ? "#e28c93" : value > 60 ? "#5fb98a" : "#8b8d96";
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
  /** Set when the list came from an earlier day, or not at all. */
  const [evMeta, setEvMeta] = useState<{ stale?: boolean; builtOn?: string; reason?: string }>({});
  const [c, setC] = useState<Corr | null>(null);
  const [corrBusy, setCorrBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const j = await withDeadline<{ data?: { events?: CalEvent[]; stale?: boolean; builtOn?: string; reason?: string } }>(
        "/api/market/calendar",
      );
      setEvents(j?.data?.events ?? []);
      setEvMeta({ stale: j?.data?.stale, builtOn: j?.data?.builtOn, reason: j ? j.data?.reason : "The request timed out." });
    })();
  }, []);

  const picked = symbols.slice(0, 6);
  const loadCorr = useCallback(() => {
    if (picked.length < 2) return;
    setCorrBusy(true);
    void withDeadline<{ ok?: boolean; data?: Corr }>(`/api/market/correlation?symbols=${encodeURIComponent(picked.join(","))}`)
      .then((j) => setC(j?.ok ? (j.data ?? null) : null))
      .finally(() => setCorrBusy(false));
  }, [picked.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const cell = (v: number) => {
    const m = Math.min(1, Math.abs(v));
    return v >= 0 ? `rgba(255, 255, 255,${0.08 + m * 0.6})` : `rgba(248,113,113,${0.08 + m * 0.6})`;
  };

  return (
    <div className="mk-grid2">
      <div className="mk-card">
        <div className="mk-head">
          <CalendarClock className="size-3.5" /><h3>UPCOMING</h3><span className="mk-line" />
          {/* A figure labelled current when it is not is worse than one
              labelled stale, so the panel says which day it was built on. */}
          {evMeta.stale && evMeta.builtOn && <span className="mk-tag stale">FROM {evMeta.builtOn.slice(5)}</span>}
        </div>
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
        ) : events && <p className="mk-dim">{evMeta.reason ?? "No dated events found in today\u2019s headlines."}</p>}
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
