"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/features/dashboard/command.css";

/**
 * Whether the numbers are going up.
 *
 * Volume and session counts describe how much you did. Over months the only
 * question that matters is whether it is working, and on which lifts it is
 * not — which needs the first session compared against the latest, per lift,
 * not a total.
 */

interface Lift {
  name: string;
  sessions: number;
  bestKg: number | null;
  latestKg: number | null;
  changeKg: number | null;
  changePct: number | null;
  e1rm: number | null;
  trend: "up" | "flat" | "down" | "new";
  daysSince: number;
}
interface Progress {
  lifts: Lift[];
  weeklyVolume: { week: string; volumeKg: number; sessions: number }[];
  neglected: Lift[];
  notes: string[];
}

const WINDOWS = [60, 120, 365];

const TREND: Record<Lift["trend"], { mark: string; cls: string }> = {
  up: { mark: "▲", cls: "text-[var(--live)]" },
  down: { mark: "▼", cls: "text-red-300" },
  flat: { mark: "–", cls: "text-subtle" },
  new: { mark: "·", cls: "text-subtle" },
};

const tonnes = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)}t` : `${kg}kg`);

export function ProgressPanel() {
  const [days, setDays] = useState(120);
  const [p, setP] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    const j = await fetch(`/api/health/progress?days=${d}`).then((r) => r.json()).catch(() => null);
    setP(j?.ok ? (j.data as Progress) : null);
    setLoading(false);
  }, []);
  useEffect(() => { void load(days); }, [load, days]);

  const weeks = p?.weeklyVolume ?? [];
  const peak = Math.max(1, ...weeks.map((w) => w.volumeKg));

  return (
    <div className="mono-grid mt-4 grid-cols-1">
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="hud-label flex items-center gap-2"><TrendingUp className="size-3.5" /> PROGRESSION</p>
          <div className="ml-auto flex items-center gap-1 border border-border-glass">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={cn("hud-label px-2.5 py-1 transition-colors", days === w ? "bg-glass-strong !text-foreground" : "hover:!text-foreground")}
              >
                {w === 365 ? "1Y" : `${w}D`}
              </button>
            ))}
          </div>
        </div>

        {loading && !p && <p className="mt-3 text-sm text-subtle"><Loader2 className="inline size-3 animate-spin" /> reading your sessions…</p>}
        {p && p.lifts.length === 0 && (
          <p className="mt-3 text-sm text-subtle">
            No lift data in this window. Import a Hevy CSV above and this fills in — it is
            derived from sessions you already have, so there is nothing extra to log.
          </p>
        )}

        {p && p.lifts.length > 0 && (
          <>
            {weeks.length > 1 && (
              <>
                <p className="hud-label mt-4">WEEKLY VOLUME</p>
                <div className="mt-2 flex h-16 items-end gap-[3px]">
                  {weeks.map((w) => (
                    <div
                      key={w.week}
                      title={`Week of ${w.week}: ${tonnes(w.volumeKg)} across ${w.sessions} session${w.sessions === 1 ? "" : "s"}`}
                      className="min-w-[3px] flex-1 bg-[var(--live)] opacity-70 transition-opacity hover:opacity-100"
                      style={{ height: `${Math.max(2, (w.volumeKg / peak) * 100)}%` }}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-subtle">
                  <span>{weeks[0]?.week}</span>
                  <span>peak {tonnes(peak)}</span>
                </div>
              </>
            )}

            <p className="hud-label mt-4">PER LIFT · FIRST SESSION → LATEST</p>
            <div className="mt-2 flex flex-col gap-1">
              {p.lifts.slice(0, 10).map((l) => (
                <div key={l.name} className="flex items-baseline gap-3 text-[12px]">
                  <span className={cn("w-3 shrink-0 font-mono", TREND[l.trend].cls)}>{TREND[l.trend].mark}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{l.name}</span>
                  <span className="font-mono text-[9px] tracking-wide text-subtle">{l.sessions}×</span>
                  <span
                    className="w-14 text-right font-mono text-[10px] text-subtle"
                    title={l.e1rm ? `Estimated 1RM ≈ ${l.e1rm}kg (Epley, assuming 8 reps)` : undefined}
                  >
                    {l.bestKg != null ? `${l.bestKg}kg` : "bw"}
                  </span>
                  <span className={cn("w-14 text-right font-mono text-[10px]", TREND[l.trend].cls)}>
                    {l.changeKg == null || l.trend === "new"
                      ? "—"
                      : `${l.changeKg > 0 ? "+" : ""}${l.changeKg}kg`}
                  </span>
                </div>
              ))}
            </div>

            {p.notes.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5">
                {p.notes.map((n, i) => (
                  <p key={i} className="flex items-start gap-2 text-[11px] text-subtle">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {n}
                  </p>
                ))}
              </div>
            )}

            <p className="mt-3 text-[10px] text-subtle">
              Change compares the heaviest set in your first session of the window with your
              latest. Estimated 1RMs assume 8 reps — Hevy&apos;s export does not carry reps per
              exercise, so treat them as a guide, not a measurement.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
