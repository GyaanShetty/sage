"use client";

import { useCallback, useEffect, useState } from "react";
import { DotGlobe, type GlobeArc, type GlobeMarker } from "@/features/globe/dot-globe";
import "../globe-hero.css";

interface Quote { symbol: string; name: string; price: number; changePct: number }
interface Sector { symbol: string; label: string; region: "IN" | "US"; changePct: number | null }
interface SectorData { sectors: Sector[]; leaders: Sector[]; laggards: Sector[]; breadth: number | null }
interface Sentiment { value: number; label: string; delta: number; history: { at: string; value: number }[] }

/** Financial centres, plotted as live nodes on the globe. */
const EXCHANGES: GlobeMarker[] = [
  { lon: 72.87, lat: 19.07, label: "BSE/NSE", hot: true },
  { lon: -74.0, lat: 40.71, label: "NYSE", hot: true },
  { lon: -0.13, lat: 51.51, label: "LSE" },
  { lon: 139.69, lat: 35.69, label: "TSE" },
  { lon: 103.82, lat: 1.35, label: "SGX" },
  { lon: 8.68, lat: 50.11, label: "DAX" },
  { lon: 114.17, lat: 22.32, label: "HKEX" },
  { lon: 55.27, lat: 25.2, label: "DFM" },
  { lon: -122.42, lat: 37.77, label: "SF" },
  { lon: 151.21, lat: -33.87, label: "ASX" },
];

const FLOWS: GlobeArc[] = [
  { from: [72.87, 19.07], to: [-74.0, 40.71], hot: true },
  { from: [72.87, 19.07], to: [-0.13, 51.51] },
  { from: [72.87, 19.07], to: [103.82, 1.35], hot: true },
  { from: [-74.0, 40.71], to: [-0.13, 51.51] },
  { from: [139.69, 35.69], to: [-74.0, 40.71] },
  { from: [114.17, 22.32], to: [8.68, 50.11] },
  { from: [55.27, 25.2], to: [72.87, 19.07] },
  { from: [103.82, 1.35], to: [139.69, 35.69] },
  { from: [-122.42, 37.77], to: [139.69, 35.69] },
  { from: [151.21, -33.87], to: [103.82, 1.35] },
];

/** Rough local trading windows (IST hours) to show which desks are live. */
const SESSIONS: { label: string; open: number; close: number }[] = [
  { label: "MUMBAI", open: 9.25, close: 15.5 },
  { label: "LONDON", open: 13.5, close: 21.5 },
  { label: "NEW YORK", open: 19, close: 25.5 },
  { label: "TOKYO", open: 5.5, close: 11.5 },
];

const pct = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;

export function GlobeHero({ userName = "Gyaan" }: { userName?: string }) {
  const [indices, setIndices] = useState<Quote[] | null>(null);
  const [sectors, setSectors] = useState<SectorData | null>(null);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [clock, setClock] = useState("");
  const [istHour, setIstHour] = useState(0);

  const load = useCallback(() => {
    fetch("/api/market/quotes?symbols=^NSEI,^BSESN,^GSPC,^IXIC")
      .then((r) => r.json()).then((j) => setIndices(j?.data ?? [])).catch(() => setIndices([]));
    fetch("/api/market/sectors")
      .then((r) => r.json()).then((j) => setSectors(j?.data ?? null)).catch(() => {});
    fetch("/api/market/sentiment")
      .then((r) => r.json()).then((j) => setSentiment(j?.data ?? null)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).formatToParts(now);
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      setClock(`${String(get("hour")).padStart(2, "0")}:${String(get("minute")).padStart(2, "0")}:${String(get("second")).padStart(2, "0")}`);
      setIstHour(get("hour") + get("minute") / 60);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const heat = (v: number | null) => {
    if (v == null) return "rgba(255,255,255,.05)";
    const m = Math.min(1, Math.abs(v) / 2.5);
    return v >= 0 ? `rgba(52,211,153,${0.1 + m * 0.5})` : `rgba(248,113,113,${0.1 + m * 0.5})`;
  };

  const sessionOpen = (s: (typeof SESSIONS)[number]) => {
    const h = istHour;
    return s.close > 24 ? h >= s.open || h <= s.close - 24 : h >= s.open && h <= s.close;
  };

  return (
    <section className="gh">
      {/* ── top rail ─────────────────────────────────────────── */}
      <div className="gh-rail">
        <div className="gh-brand">
          <span className="gh-mark">SAGE</span>
          <span className="gh-sub">GLOBAL SURVEILLANCE · {userName.toUpperCase()}</span>
        </div>
        <div className="gh-ticker">
          {(indices ?? []).map((q) => (
            <span key={q.symbol} className="gh-tick">
              <b>{q.name?.replace(/\s*Index$/i, "") ?? q.symbol}</b>
              <i className={q.changePct >= 0 ? "up" : "dn"}>{pct(q.changePct)}</i>
            </span>
          ))}
          {indices === null && <span className="gh-tick"><i className="gh-dim">ACQUIRING FEEDS…</i></span>}
        </div>
        <div className="gh-clock">
          <span className="gh-dim">IST</span>
          <span className="gh-clockval">{clock}</span>
        </div>
      </div>

      {/* ── stage ────────────────────────────────────────────── */}
      <div className="gh-stage">
        {/* left rail */}
        <aside className="gh-side">
          <div className="gh-block">
            <div className="gh-blockhead"><span className="gh-code">A</span><h4>INDICES</h4><span className="gh-line" /></div>
            <div className="gh-idxlist">
              {(indices ?? []).map((q) => (
                <div key={q.symbol} className="gh-idx">
                  <span className="gh-idxname">{q.name?.replace(/\s*Index$/i, "") ?? q.symbol}</span>
                  <span className={`gh-idxpct ${q.changePct >= 0 ? "up" : "dn"}`}>{pct(q.changePct)}</span>
                </div>
              ))}
              {!indices?.length && <p className="gh-dim">{indices === null ? "acquiring…" : "feed unavailable"}</p>}
            </div>
          </div>

          <div className="gh-block">
            <div className="gh-blockhead"><span className="gh-code">B</span><h4>SESSIONS</h4><span className="gh-line" /></div>
            <div className="gh-sessions">
              {SESSIONS.map((s) => (
                <div key={s.label} className={`gh-session ${sessionOpen(s) ? "live" : ""}`}>
                  <i /> <span>{s.label}</span>
                  <b>{sessionOpen(s) ? "OPEN" : "CLOSED"}</b>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* globe */}
        <div className="gh-globe">
          <span className="gh-corner tl" /><span className="gh-corner tr" />
          <span className="gh-corner bl" /><span className="gh-corner br" />
          <div className="gh-canvas">
            <DotGlobe markers={EXCHANGES} arcs={FLOWS} speed={5} />
          </div>
          <div className="gh-stagemeta">
            <span>ORTHOGRAPHIC · LIVE · DRAG TO ROTATE</span>
            <span>{EXCHANGES.length} NODES · {FLOWS.length} FLOWS</span>
          </div>
        </div>

        {/* right rail */}
        <aside className="gh-side">
          <div className="gh-block">
            <div className="gh-blockhead"><span className="gh-code">C</span><h4>SENTIMENT</h4><span className="gh-line" /></div>
            {sentiment ? (
              <div className="gh-fng">
                <Gauge value={sentiment.value} />
                <div className="gh-fngmeta">
                  <span className="gh-fnglabel">{sentiment.label.toUpperCase()}</span>
                  <span className={`gh-fngdelta ${sentiment.delta >= 0 ? "up" : "dn"}`}>
                    {sentiment.delta >= 0 ? "▲" : "▼"} {Math.abs(sentiment.delta)} wk
                  </span>
                </div>
              </div>
            ) : <p className="gh-dim">no signal</p>}
          </div>

          <div className="gh-block">
            <div className="gh-blockhead"><span className="gh-code">D</span><h4>SECTORS</h4><span className="gh-line" /></div>
            <div className="gh-heat">
              {(sectors?.sectors ?? []).slice(0, 12).map((s) => (
                <div key={s.symbol} className="gh-heatcell" style={{ background: heat(s.changePct) }} title={`${s.label} · ${pct(s.changePct)}`}>
                  <span className="gh-heatlbl">{s.label}</span>
                  <span className="gh-heatval">{pct(s.changePct, 1)}</span>
                </div>
              ))}
              {!sectors?.sectors?.length && <p className="gh-dim">{sectors === null ? "acquiring…" : "feed unavailable"}</p>}
            </div>
            {sectors?.breadth != null && (
              <div className="gh-breadth">
                <div className="gh-breadthbar"><span style={{ width: `${sectors.breadth}%` }} /></div>
                <span className="gh-dim">{sectors.breadth.toFixed(0)}% GREEN</span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

/** Semicircular 0–100 dial for the fear & greed reading. */
function Gauge({ value }: { value: number }) {
  const r = 38, cx = 46, cy = 46;
  const angle = Math.PI * (1 - value / 100);
  const x = cx + Math.cos(angle) * r;
  const y = cy - Math.sin(angle) * r;
  const col = value < 25 ? "#f87171" : value < 45 ? "#fb923c" : value < 55 ? "#facc15" : value < 75 ? "#a3e635" : "#34d399";
  return (
    <svg viewBox="0 0 92 56" className="gh-gauge">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="6" strokeLinecap="round" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}`} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round" />
      <text x={cx} y={cy - 5} textAnchor="middle" className="gh-gaugeval" fill={col}>{value}</text>
    </svg>
  );
}
