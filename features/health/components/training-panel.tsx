"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dumbbell, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/features/dashboard/command.css";

interface Summary {
  workouts: number;
  totalVolumeKg: number;
  totalMinutes: number;
  perWeek: number;
  topExercises: { name: string; sets: number; bestKg: number | null }[];
  lastAt: string | null;
}

const WINDOWS = [30, 90, 180];

/** Tonnes read better than five-digit kilogram counts once volume gets real —
 *  "610t" lands, "609,966 kg" does not. */
function volume(kg: number): string {
  if (kg >= 100_000) return `${(kg / 1000).toFixed(0)}t`;
  if (kg >= 10_000) return `${(kg / 1000).toFixed(1)}t`;
  return `${kg.toLocaleString()}kg`;
}

export function TrainingPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (d: number) => {
    const j = await fetch(`/api/health/hevy?days=${d}`).then((r) => r.json()).catch(() => null);
    setData(j?.ok ? j.data : null);
  }, []);
  useEffect(() => { void load(days); }, [load, days]);

  const upload = async (file: File) => {
    setBusy(true); setNote(null);
    const body = new FormData();
    body.append("file", file);
    const j = await fetch("/api/health/hevy", { method: "POST", body }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    setNote(
      j?.ok
        ? `${j.data.parsed} workouts read — ${j.data.added} new, ${j.data.updated} updated.`
        : j?.error ?? "That import failed.",
    );
    await load(days);
  };

  const sync = async () => {
    setBusy(true); setNote(null);
    const j = await fetch("/api/health/hevy", { method: "POST" }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    setNote(j?.ok ? `Synced — ${j.data.added} new, ${j.data.updated} updated.` : j?.error ?? "Sync failed.");
    await load(days);
  };

  return (
    <div className="mono-grid mt-4 grid-cols-1">
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="hud-label flex items-center gap-2"><Dumbbell className="size-3.5" /> TRAINING</p>
          <div className="ml-auto flex items-center gap-1 border border-border-glass">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={cn("hud-label px-2.5 py-1 transition-colors", days === w ? "bg-glass-strong !text-foreground" : "hover:!text-foreground")}
              >
                {w}D
              </button>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";     // same file twice must still fire
              if (f) void upload(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Import a Hevy CSV export"
            className="hud-label flex items-center gap-1.5 border border-border-glass px-2.5 py-1 transition-colors hover:border-border-glass-strong hover:!text-foreground disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />} CSV
          </button>
          <button
            onClick={sync}
            disabled={busy}
            title="Pull from the Hevy API (needs HEVY_API_KEY)"
            className="hud-label border border-border-glass px-2.5 py-1 transition-colors hover:border-border-glass-strong hover:!text-foreground disabled:opacity-40"
          >
            SYNC
          </button>
        </div>

        {note && <p className="mt-2 text-xs text-muted">{note}</p>}

        {!data && <p className="mt-3 text-sm text-subtle">Loading…</p>}
        {data && data.workouts === 0 && (
          <p className="mt-3 text-sm text-subtle">
            No sessions in this window. Import a Hevy export (Hevy → Settings → Export Data)
            or set HEVY_API_KEY to sync automatically.
          </p>
        )}

        {data && data.workouts > 0 && (
          <>
            <div className="rp-stats mt-3">
              <div className="rp-stat">
                <div className="rp-stat-v num">{data.workouts}</div>
                <div className="rp-stat-k">Sessions</div>
                <div className="rp-stat-s">{data.perWeek}/week</div>
              </div>
              <div className="rp-stat">
                <div className="rp-stat-v num">{volume(data.totalVolumeKg)}</div>
                <div className="rp-stat-k">Volume moved</div>
                <div className="rp-stat-s">weight × reps</div>
              </div>
              <div className="rp-stat">
                <div className="rp-stat-v num">{Math.round(data.totalMinutes / 60)}h</div>
                <div className="rp-stat-k">Under the bar</div>
              </div>
              <div className="rp-stat">
                <div className="rp-stat-v num">
                  {data.lastAt ? `${Math.floor((Date.now() - new Date(data.lastAt).getTime()) / 86_400_000)}d` : "—"}
                </div>
                <div className="rp-stat-k">Since last</div>
              </div>
            </div>

            <p className="hud-label mt-4">MOST TRAINED · BEST SET</p>
            <div className="mt-2 flex flex-col gap-1">
              {data.topExercises.map((e) => (
                <div key={e.name} className="flex items-baseline gap-3 text-[12px]">
                  <span className="min-w-0 flex-1 truncate text-muted">{e.name}</span>
                  <span className="font-mono text-[9px] tracking-wide text-subtle">{e.sets}×</span>
                  <span className="font-mono text-[10px] text-[var(--live)]">
                    {e.bestKg != null ? `${e.bestKg}kg` : "bw"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
