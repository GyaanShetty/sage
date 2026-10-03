"use client";

import { useCallback, useEffect, useState } from "react";
import { Ghost, Loader2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The shadow book.
 *
 * Everyone is sure the trades they skipped would have won; almost nobody
 * checks, because nothing records a trade that never happened. This records it
 * at the price you would have paid and scores the ghost later.
 */

interface Trade {
  id: string; symbol: string; side: "buy" | "short"; price: number; size: number;
  thesis: string; whyNot: string; at: string;
  markPrice: number | null; pnl: number | null; pnlPct: number | null; days: number;
  closedAt?: string | null;
}
interface Summary { trades: Trade[]; netPnl: number; wouldHaveWon: number; scored: number; verdict: string }

const money = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export function ShadowPanel() {
  const [s, setS] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState({ symbol: "", side: "buy", price: "", size: "", thesis: "", whyNot: "" });

  const load = useCallback(async () => {
    const j = await fetch("/api/shadow").then((r) => r.json()).catch(() => null);
    if (j?.ok) setS(j.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!d.symbol.trim() || !d.price || !d.size || busy) return;
    setBusy(true);
    const j = await fetch("/api/shadow", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...d, price: Number(d.price), size: Number(d.size) }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (j?.ok) { setS(j.data); setD({ symbol: "", side: d.side, price: "", size: "", thesis: "", whyNot: "" }); setOpen(false); }
  };

  const remove = async (id: string) => {
    const j = await fetch(`/api/shadow?id=${id}`, { method: "DELETE" }).then((r) => r.json()).catch(() => null);
    if (j?.ok) setS(j.data);
  };

  return (
    <div className="pf-card" style={{ marginTop: 12 }}>
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}>
          <span className="sn"><Ghost className="size-3.5" /></span>
          <h2>Shadow book</h2><span className="line" />
          {s && s.scored > 0 && (
            <span className={cn("tag", s.netPnl > 0 && "!text-[#f87171]")}>
              {money(s.netPnl)} {s.netPnl >= 0 ? "MISSED" : "SAVED"}
            </span>
          )}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="cc-btn">
          {open ? <X className="size-3.5" /> : <Plus className="size-3.5" />} {open ? "Cancel" : "Log a skip"}
        </button>
      </div>

      <p className="sh-intro">
        Trades you thought about and didn&apos;t take, scored against what actually happened.
        Your real book cannot answer whether hesitation is costing you; this can.
      </p>

      {open && (
        <div className="sh-form">
          <input value={d.symbol} onChange={(e) => setD({ ...d, symbol: e.target.value })} placeholder="BTC · RELIANCE.BSE" />
          <select value={d.side} onChange={(e) => setD({ ...d, side: e.target.value })}>
            <option value="buy">buy</option><option value="short">short</option>
          </select>
          <input value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} placeholder="Price you'd have paid" type="number" />
          <input value={d.size} onChange={(e) => setD({ ...d, size: e.target.value })} placeholder="Size" type="number" step="any" />
          <input value={d.thesis} onChange={(e) => setD({ ...d, thesis: e.target.value })} placeholder="Why you were tempted" />
          <input value={d.whyNot} onChange={(e) => setD({ ...d, whyNot: e.target.value })} placeholder="Why you didn't" />
          <button onClick={() => void add()} disabled={busy} className="cc-btn cc-scan">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Log it
          </button>
        </div>
      )}

      {s && <p className="sh-verdict">{s.verdict}</p>}

      {s && s.trades.length > 0 && (
        <div className="sh-list">
          {s.trades.map((t) => (
            <div key={t.id} className="sh-row">
              <span className={cn("sh-side", t.side)}>{t.side}</span>
              <span className="sh-sym">{t.symbol}</span>
              <span className="sh-px">{t.price.toLocaleString()} → {t.markPrice?.toLocaleString() ?? "—"}</span>
              <span className={cn("sh-pnl", t.pnl !== null && (t.pnl > 0 ? "missed" : "saved"))}>
                {t.pnl === null ? "unpriced" : `${money(t.pnl)}${t.pnlPct !== null ? ` · ${t.pnlPct.toFixed(0)}%` : ""}`}
              </span>
              <span className="sh-why" title={`${t.thesis}${t.whyNot ? ` — didn't because: ${t.whyNot}` : ""}`}>
                {t.whyNot || t.thesis}
              </span>
              <span className="sh-age">{t.days}d</span>
              <button onClick={() => void remove(t.id)} className="cc-del"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
