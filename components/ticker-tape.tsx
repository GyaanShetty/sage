"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Item {
  label: string;
  value: string;
  up?: boolean | null;
}

/** Continuous market ticker under the status bar — the room's heartbeat. */
export function TickerTape() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const load = async () => {
      const out: Item[] = [];
      try {
        const [idx, coins, fx] = await Promise.all([
          fetch("/api/market/quotes?symbols=^NSEI,^BSESN,NVDA,AAPL").then((r) => r.json()).catch(() => null),
          fetch("/api/markets").then((r) => r.json()).catch(() => null),
          fetch("/api/fx").then((r) => r.json()).catch(() => null),
        ]);
        for (const q of idx?.data ?? []) {
          out.push({
            label: (q.name as string).replace("S&P BSE SENSEX", "SENSEX").toUpperCase(),
            value: `${q.currency === "INR" ? "₹" : "$"}${q.price >= 1000 ? Math.round(q.price).toLocaleString("en-IN") : q.price.toFixed(2)} ${q.changePct >= 0 ? "▲" : "▽"}${Math.abs(q.changePct).toFixed(2)}%`,
            up: q.changePct >= 0,
          });
        }
        for (const c of coins?.data ?? []) {
          out.push({
            label: c.symbol,
            value: `$${c.price >= 1000 ? Math.round(c.price).toLocaleString() : c.price.toFixed(2)} ${c.change24h >= 0 ? "▲" : "▽"}${Math.abs(c.change24h).toFixed(1)}%`,
            up: c.change24h >= 0,
          });
        }
        for (const f of fx?.data ?? []) {
          if (f.pair === "USD/INR" || f.pair === "EUR/INR") {
            out.push({ label: f.pair, value: `₹${f.rate.toFixed(2)}`, up: null });
          }
        }
      } catch {}
      if (out.length) setItems(out);
    };
    load();
    const t = setInterval(load, 150000);
    return () => clearInterval(t);
  }, []);

  if (!items.length) return null;
  // Duplicate the run so the loop is seamless.
  const run = [...items, ...items];

  return (
    <Link href="/markets" className="tape" aria-label="Open markets">
      <div className="tape-track" style={{ animationDuration: `${items.length * 5}s` }}>
        {run.map((it, i) => (
          <span className="tape-item" key={i}>
            <span className="tape-label">{it.label}</span>
            <span className={it.up === null ? "tape-val" : it.up ? "tape-val up" : "tape-val dn"}>{it.value}</span>
            <span className="tape-sep">◆</span>
          </span>
        ))}
      </div>
    </Link>
  );
}
