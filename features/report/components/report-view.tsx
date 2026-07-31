"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Link2, Loader2, Sparkles, Target } from "lucide-react";
import { staggerContainer, fadeRise } from "@/lib/motion";
import "@/features/dashboard/command.css";
import { AsciiTitle } from "@/components/ui/ascii-title";

interface Signals {
  days: number;
  tasks: { done: number; open: number; overdue: number; created: number };
  career: { total: number; interviewRatePct: number; offerRatePct: number; quiet: number; movedStages: number };
  money: { spend: number; byCategory: Record<string, number>; holdings: number };
  health: { avgSteps: number | null; avgSleep: number | null; workouts: number };
  mind: { memoriesAdded: number; notesWritten: number; retired: number };
  ops: { automationRuns: number; automationFailures: number; briefsGenerated: number };
}
interface Report {
  headline: string;
  moved: string[];
  slipping: string[];
  patterns: string[];
  recommendations: { title: string; why: string; action: string }[];
  period: number;
  generatedAt: string;
  signals: Signals;
}

const WINDOWS = [7, 30, 90];

/** A measured figure. Nulls read as "no data" rather than zero — the two mean
 *  very different things and conflating them invents a finding. */
function Stat({ label, value, sub }: { label: string; value: string | number | null; sub?: string }) {
  return (
    <div className="rp-stat">
      <div className="rp-stat-v num">{value === null || value === undefined ? "—" : value}</div>
      <div className="rp-stat-k">{label}</div>
      {sub && <div className="rp-stat-s">{sub}</div>}
    </div>
  );
}

export function ReportView() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/report").then((r) => r.json()).catch(() => null);
    setReports(j?.ok ? (j.data as Report[]) : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    const j = await fetch("/api/report", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ days }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (j?.ok) setReports((r) => [j.data as Report, ...(r ?? [])]);
    else setError(j?.error ?? "Couldn't generate the report.");
  };

  const latest = reports?.[0] ?? null;
  const s = latest?.signals;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.div variants={fadeRise} className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="hud-label">CROSS-DOMAIN REVIEW</p>
            <h1 className="mt-1"><AsciiTitle text="The Report" scale={1.35} /></h1>
            <p className="mt-1 max-w-lg text-sm text-muted">
              Every part of the system read at once. The interesting findings live between
              the pages, not on them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex border border-border-glass">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  onClick={() => setDays(w)}
                  className={`hud-label px-3 py-2 transition-colors ${days === w ? "bg-glass-strong !text-foreground" : "hover:!text-foreground"}`}
                >
                  {w}D
                </button>
              ))}
            </div>
            <button
              onClick={generate}
              disabled={busy}
              className="hud-label flex items-center gap-2 bg-foreground px-4 py-2 !text-background transition-opacity disabled:opacity-30"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {busy ? "READING…" : "RUN REPORT"}
            </button>
          </div>
        </motion.div>

        {error && <p className="mt-4 border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{error}</p>}

        {reports === null && <p className="mt-10 text-center text-sm text-subtle">Loading…</p>}
        {reports?.length === 0 && (
          <p className="mt-16 text-center text-sm text-subtle">
            No reports yet. Run one — it reads tasks, pipeline, spending, health, memory and automations together.
          </p>
        )}

        {latest && s && (
          <>
            <motion.p variants={fadeRise} className="mt-6 border-l-2 border-[var(--live-dim)] pl-4 text-lg leading-relaxed">
              {latest.headline}
            </motion.p>
            <p className="hud-label mt-2">
              LAST {latest.period} DAYS · GENERATED{" "}
              {new Date(latest.generatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase()}
            </p>

            {/* The measured basis. Shown because the prose is only trustworthy
                if you can see the numbers it was allowed to speak from. */}
            <motion.div variants={fadeRise} className="rp-stats mt-5">
              <Stat label="Tasks done" value={s.tasks.done} sub={`${s.tasks.open} open · ${s.tasks.overdue} overdue`} />
              <Stat label="Pipeline moves" value={s.career.movedStages} sub={`${s.career.total} live · ${s.career.quiet} quiet`} />
              <Stat label="Interview rate" value={s.career.total ? `${s.career.interviewRatePct}%` : null} sub={`${s.career.offerRatePct}% to offer`} />
              <Stat label="Spend" value={s.money.spend ? `₹${s.money.spend.toLocaleString("en-IN")}` : null} sub={`${Object.keys(s.money.byCategory).length} categories`} />
              <Stat label="Avg steps" value={s.health.avgSteps} sub={s.health.avgSleep ? `${s.health.avgSleep}h sleep` : "no sleep data"} />
              <Stat label="Memories" value={s.mind.memoriesAdded} sub={`${s.mind.notesWritten} notes · ${s.mind.retired} retired`} />
              <Stat label="Automation runs" value={s.ops.automationRuns} sub={s.ops.automationFailures ? `${s.ops.automationFailures} failed` : "none failed"} />
              <Stat label="Briefings" value={s.ops.briefsGenerated} />
            </motion.div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <motion.div variants={fadeRise} className="mono-grid grid-cols-1">
                <div className="p-4">
                  <p className="hud-label flex items-center gap-2"><ArrowUpRight className="size-3.5" /> MOVED</p>
                  <ul className="mt-2 space-y-1.5">
                    {latest.moved.length === 0 && <li className="text-sm text-subtle">Nothing meaningful moved.</li>}
                    {latest.moved.map((m, i) => <li key={i} className="text-sm text-muted">{m}</li>)}
                  </ul>
                </div>
              </motion.div>
              <motion.div variants={fadeRise} className="mono-grid grid-cols-1">
                <div className="p-4">
                  <p className="hud-label flex items-center gap-2"><ArrowDownRight className="size-3.5" /> SLIPPING</p>
                  <ul className="mt-2 space-y-1.5">
                    {latest.slipping.length === 0 && <li className="text-sm text-subtle">Nothing slipping.</li>}
                    {latest.slipping.map((m, i) => <li key={i} className="text-sm text-muted">{m}</li>)}
                  </ul>
                </div>
              </motion.div>
            </div>

            {latest.patterns.length > 0 && (
              <motion.div variants={fadeRise} className="mono-grid mt-4 grid-cols-1">
                <div className="p-4">
                  <p className="hud-label flex items-center gap-2"><Link2 className="size-3.5" /> PATTERNS ACROSS DOMAINS</p>
                  <ul className="mt-2 space-y-2">
                    {latest.patterns.map((p, i) => (
                      <li key={i} className="border-l border-[var(--live-dim)] pl-3 text-sm text-muted">{p}</li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            )}

            {latest.recommendations.length > 0 && (
              <motion.div variants={fadeRise} className="mono-grid mt-4 grid-cols-1">
                {latest.recommendations.map((r, i) => (
                  <div key={i} className="p-4">
                    <p className="flex items-center gap-2 font-mono text-sm font-medium">
                      <Target className="size-3.5 text-[var(--live)]" /> {r.title}
                    </p>
                    <p className="mt-1.5 text-sm text-muted">{r.why}</p>
                    <p className="mt-2 border-l border-border-glass pl-3 text-sm">{r.action}</p>
                  </div>
                ))}
              </motion.div>
            )}

            {(reports?.length ?? 0) > 1 && (
              <motion.div variants={fadeRise} className="mt-6">
                <p className="hud-label">EARLIER</p>
                <div className="mono-grid mt-2 grid-cols-1">
                  {reports!.slice(1).map((r, i) => (
                    <div key={i} className="flex items-baseline gap-3 p-3">
                      <span className="hud-label shrink-0">
                        {new Date(r.generatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}
                      </span>
                      <span className="text-sm text-muted">{r.headline}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
