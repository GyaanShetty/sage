"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Readiness from training load, not from a vibe.
 *
 * The number that matters is the acute-to-chronic workload ratio: this week's
 * load against the four-week average the body has adapted to. Sleep sits
 * beside it rather than being blended in, because "under-recovered" and
 * "ramping too fast" call for different things and averaging them hides which
 * one is true.
 */

interface Readiness {
  acute: number; chronic: number; ratio: number | null;
  band: "detraining" | "sweet-spot" | "ramping" | "danger" | "unknown";
  sleepDebt: number; nights: number; score: number | null;
  verdict: string; advice: string;
}

const BAND_LABEL: Record<Readiness["band"], string> = {
  "sweet-spot": "IN THE SWEET SPOT",
  ramping: "RAMPING",
  danger: "RAMPING HARD",
  detraining: "BACKING OFF",
  unknown: "NOT ENOUGH DATA",
};

export function ReadinessPanel() {
  const [r, setR] = useState<Readiness | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/readiness").then((r) => r.json()).catch(() => null);
    if (j?.ok) setR(j.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!r) return <div className="hl-card"><p className="hl-empty"><Loader2 className="inline size-3 animate-spin" /> reading your load…</p></div>;

  // The ratio scale runs 0.5–2.0; the sweet spot is 0.8–1.3.
  const pos = r.ratio === null ? null : Math.max(0, Math.min(1, (r.ratio - 0.5) / 1.5));

  return (
    <div className="hl-card">
      <div className="hl-cardhead">
        <Activity className="size-3.5" /><h3>READINESS</h3>
        <span className={cn("hl-avg", `rd-${r.band}`)}>{BAND_LABEL[r.band]}</span>
      </div>

      {r.score !== null && (
        <div className="rd-score">
          <b>{r.score}</b>
          <span>out of 100 — load and sleep together</span>
        </div>
      )}

      {pos !== null && (
        <>
          <div className="rd-scale">
            {/* The sweet spot drawn to scale, so the marker is read against it
                rather than against an invented midpoint. */}
            <span className="rd-sweet" style={{ left: `${((0.8 - 0.5) / 1.5) * 100}%`, width: `${((1.3 - 0.8) / 1.5) * 100}%` }} />
            <span className={cn("rd-marker", `rd-${r.band}`)} style={{ left: `${pos * 100}%` }} />
          </div>
          <div className="rd-ticks"><span>0.5</span><span>1.0</span><span>1.5</span><span>2.0</span></div>
        </>
      )}

      <p className="rd-verdict">{r.verdict}</p>
      <p className="rd-advice">{r.advice}</p>

      <p className="rd-foot">
        Acute {r.acute} vs chronic {r.chronic} · {r.nights} night{r.nights === 1 ? "" : "s"} of sleep logged
        {r.sleepDebt > 0 ? ` · ${r.sleepDebt}h down` : ""}
      </p>
    </div>
  );
}
