"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import "./drift.css";

/**
 * How his attention has moved.
 *
 * Nobody notices their own drift — the thing you thought about constantly in
 * March stops coming up, and because it stopped gradually there is no moment
 * where you notice it went.
 *
 * No model anywhere near this. A model asked "how has he changed" always finds
 * a change, which is the one failure that would make this worthless.
 */

interface MonthTheme { month: string; count: number; themes: { term: string; score: number; n: number }[] }
interface Drift { months: MonthTheme[]; emerged: string[]; faded: string[]; constant: string[]; notes: string[] }

const label = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

export function DriftPanel() {
  const [d, setD] = useState<Drift | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/drift").then((r) => r.json()).catch(() => null);
    if (j?.ok) setD(j.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!d) {
    return <div className="dr-card"><p className="dr-dim"><Loader2 className="inline size-3 animate-spin" /> reading months…</p></div>;
  }

  return (
    <div className="dr-card">
      <div className="dr-head">
        <Waves className="size-3.5" /><h3>DRIFT</h3>
        <span className="dr-avg">{d.months.length} month{d.months.length === 1 ? "" : "s"}</span>
      </div>

      {d.notes.map((n, i) => <p key={i} className="dr-note">{n}</p>)}

      {d.months.length > 0 && (
        <div className="dr-months">
          {d.months.map((m) => (
            <div key={m.month} className="dr-month">
              <span className="dr-mlabel">{label(m.month)}</span>
              <div className="dr-terms">
                {m.themes.length === 0 && <span className="dr-dim">—</span>}
                {m.themes.map((t) => (
                  <span
                    key={t.term}
                    className={cn(
                      "dr-term",
                      d.emerged.includes(t.term) && "new",
                      d.faded.includes(t.term) && "gone",
                    )}
                    title={`${t.n} mentions`}
                  >
                    {t.term}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {d.constant.length > 0 && (
        <p className="dr-constant">
          <b>Throughout:</b> {d.constant.join(", ")}
        </p>
      )}

      <p className="dr-foot">
        Terms weighted by how much they belong to their own month, so what you say every
        month is reported separately rather than dressed up as a finding.
      </p>
    </div>
  );
}
