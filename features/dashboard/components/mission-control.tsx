"use client";

import { useEffect, useState } from "react";

interface Coin { symbol: string; name: string; price: number; change24h: number; spark: number[] }
interface Headline { source: string; title: string; link: string; published: number }

function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (!data.length) return null;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${19 - ((v - min) / rng) * 17}`).join(" ");
  return (
    <svg viewBox="0 0 100 21" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? "#f4f4f5" : "#5c5c62"} strokeWidth="1" />
    </svg>
  );
}

function ago(ts: number) {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}M`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}H`;
  return `${Math.round(h / 24)}D`;
}

export function MissionControl() {
  const [coins, setCoins] = useState<Coin[] | null>(null);
  const [news, setNews] = useState<Headline[] | null>(null);

  useEffect(() => {
    fetch("/api/markets").then((r) => r.json()).then((j) => setCoins(j.data ?? [])).catch(() => setCoins([]));
    fetch("/api/news").then((r) => r.json()).then((j) => setNews(j.data ?? [])).catch(() => setNews([]));
    const t = setInterval(() => {
      fetch("/api/markets").then((r) => r.json()).then((j) => setCoins(j.data ?? [])).catch(() => {});
    }, 120000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="section" id="mission" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">03</span><h2>Mission Control</h2><span className="line" /><span className="tag">MARKETS · NEWSWIRE</span></div>
      <div className="grid deckmc">
        <div className="cell">
          <div className="bh"><span className="t">Markets</span><span className="i">MKT</span><span className="r">USD · LIVE</span></div>
          {coins === null && <p className="lbl">LOADING FEED…</p>}
          {coins?.length === 0 && <p className="lbl">FEED UNAVAILABLE</p>}
          {coins?.map((c) => (
            <div className="mkt" key={c.symbol}>
              <span className="sym">{c.symbol}</span>
              <Spark data={c.spark} up={c.change24h >= 0} />
              <span className="px">${c.price >= 1000 ? Math.round(c.price).toLocaleString() : c.price.toFixed(2)}</span>
              <span className={`chg${c.change24h >= 0 ? " up" : ""}`}>{c.change24h >= 0 ? "▲" : "▽"} {Math.abs(c.change24h).toFixed(1)}%</span>
            </div>
          ))}
        </div>
        <div className="cell">
          <div className="bh"><span className="t">Newswire</span><span className="i">RSS</span><span className="r">FT · MINT · COINDESK · MIT · TED</span></div>
          {news === null && <p className="lbl">LOADING FEED…</p>}
          {news?.length === 0 && <p className="lbl">FEED UNAVAILABLE</p>}
          {news?.map((h, i) => (
            <a className="news" key={i} href={h.link} target="_blank" rel="noreferrer">
              <span className="ns">{h.source}</span>
              <div className="nh">{h.title}</div>
              <div className="nt">{ago(h.published)} AGO</div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
