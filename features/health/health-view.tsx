"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity, Moon, Flame, HeartPulse, Footprints, Droplets, Dumbbell,
  Plus, Trash2, Loader2, Send, Sparkles, Target, TrendingUp, Scale,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "./health.css";
import { TrainingPanel } from "./components/training-panel";

interface Day {
  day: string;
  steps: number | null; sleepHours: number | null; activeKcal: number | null;
  restingHr: number | null; distanceKm: number | null; weightKg: number | null; waterMl: number | null;
}
interface Workout { id: string; type: string; minutes: number; intensity: string; kcal: number | null; note?: string | null; day: string }
interface Goals { steps: number; sleepHours: number; activeKcal: number; waterMl: number; workoutsPerWeek: number }
interface Corr { r: number; n: number }
interface Data {
  today: Day | null; series: Day[]; workouts: Workout[]; goals: Goals;
  workoutsThisWeek: number; streak: number;
  averages: { steps: number | null; sleepHours: number | null; activeKcal: number | null; restingHr: number | null; weightKg: number | null };
  sleepDebt: number;
  correlations: { sleepVsSolved: Corr | null; stepsVsSolved: Corr | null };
}

const WORKOUT_TYPES = ["Run", "Gym", "Walk", "Cycle", "Swim", "Yoga", "Sport", "Other"];
const n0 = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString());
const n1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

export function HealthView() {
  const [d, setD] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wo, setWo] = useState({ type: "Run", minutes: "", intensity: "moderate", kcal: "" });
  const [manual, setManual] = useState({ steps: "", sleepHours: "", activeKcal: "", restingHr: "", weightKg: "" });
  const [editGoals, setEditGoals] = useState(false);
  const [goalDraft, setGoalDraft] = useState<Goals | null>(null);
  const [coachQ, setCoachQ] = useState("");
  const [coachA, setCoachA] = useState<string | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/health?days=30").then((r) => r.json()).catch(() => null);
    if (j?.ok) { setD(j.data); setLoadError(null); }
    else setLoadError(j?.error ?? "Couldn't reach your health data.");
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    await fetch("/api/health", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    setBusy(false);
    load();
  };

  const addWorkout = async () => {
    if (!wo.minutes) return;
    await post({ entry: "workout", type: wo.type, minutes: Number(wo.minutes), intensity: wo.intensity, kcal: wo.kcal ? Number(wo.kcal) : null });
    setWo({ type: "Run", minutes: "", intensity: "moderate", kcal: "" });
  };
  const delWorkout = async (id: string) => {
    setD((p) => (p ? { ...p, workouts: p.workouts.filter((w) => w.id !== id) } : p));
    await fetch(`/api/health?id=${id}`, { method: "DELETE" }).catch(() => {});
    load();
  };
  const logManual = async () => {
    const body: Record<string, number> = {};
    for (const [k, v] of Object.entries(manual)) if (v !== "") body[k] = Number(v);
    if (!Object.keys(body).length) return;
    await post(body);
    setManual({ steps: "", sleepHours: "", activeKcal: "", restingHr: "", weightKg: "" });
  };
  const askCoach = async (q?: string) => {
    setCoachBusy(true); setCoachA(null);
    const j = await fetch("/api/health/coach", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: q ?? coachQ }),
    }).then((r) => r.json()).catch(() => null);
    setCoachA(j?.data?.answer ?? "Couldn't reach the coach just now.");
    setCoachBusy(false);
  };
  const saveGoals = async () => {
    if (!goalDraft) return;
    setEditGoals(false);
    await post({ entry: "goals", ...goalDraft });
  };

  const g = d?.goals;
  const t = d?.today;
  const ringPct = (v: number | null | undefined, goal: number | undefined) =>
    v == null || !goal ? 0 : Math.min(100, (v / goal) * 100);

  return (
    <div className="hl-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}>
          <span className="sn"><Activity className="size-3.5" /></span>
          <h2>Health</h2><span className="line" />
          {d && <span className="tag">{d.streak}-DAY STREAK</span>}
        </div>
        <button onClick={() => { setGoalDraft(d?.goals ?? null); setEditGoals((s) => !s); }} className="cc-btn">
          <Target className="size-3.5" /> Goals
        </button>
      </div>

      <TrainingPanel />

      {!d && !loadError && <p className="lbl" style={{ padding: 16 }}>LOADING…</p>}
      {!d && loadError && (
        <div className="hl-card">
          <p className="hl-empty">{loadError}</p>
          <button onClick={load} className="hl-quickask">Retry →</button>
        </div>
      )}

      {d && (
        <>
          {/* goals editor */}
          {editGoals && goalDraft && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="hl-goals">
              {([["steps", "Steps/day"], ["sleepHours", "Sleep (h)"], ["activeKcal", "Active kcal"], ["waterMl", "Water (ml)"], ["workoutsPerWeek", "Workouts/wk"]] as const).map(([k, label]) => (
                <label key={k} className="hl-goalfield">
                  <span>{label}</span>
                  <input type="number" value={goalDraft[k]} onChange={(e) => setGoalDraft({ ...goalDraft, [k]: Number(e.target.value) })} />
                </label>
              ))}
              <button onClick={saveGoals} className="cc-btn cc-scan">Save goals</button>
            </motion.div>
          )}

          {/* today's rings */}
          <div className="hl-rings">
            <Ring icon={<Footprints className="size-4" />} label="STEPS" value={n0(t?.steps)} sub={`/ ${n0(g?.steps)}`} pct={ringPct(t?.steps, g?.steps)} tint="#f4f5f7" />
            <Ring icon={<Moon className="size-4" />} label="SLEEP" value={n1(t?.sleepHours)} sub={`/ ${g?.sleepHours}h`} pct={ringPct(t?.sleepHours, g?.sleepHours)} tint="#a855f7" />
            <Ring icon={<Flame className="size-4" />} label="ACTIVE" value={n0(t?.activeKcal)} sub={`/ ${n0(g?.activeKcal)} kcal`} pct={ringPct(t?.activeKcal, g?.activeKcal)} tint="#f59e0b" />
            <Ring icon={<Droplets className="size-4" />} label="WATER" value={n0(t?.waterMl)} sub={`/ ${n0(g?.waterMl)} ml`} pct={ringPct(t?.waterMl, g?.waterMl)} tint="#60a5fa" />
          </div>

          <div className="hl-quickrow">
            <button onClick={() => post({ waterMl: 250 })} disabled={busy} className="hl-quick"><Droplets className="size-3.5" /> +250ml</button>
            <button onClick={() => post({ waterMl: 500 })} disabled={busy} className="hl-quick"><Droplets className="size-3.5" /> +500ml</button>
            <span className="hl-quickmeta">
              <HeartPulse className="size-3.5" /> RHR {n0(t?.restingHr)}
              {d.sleepDebt > 0.5 && <em> · sleep debt {n1(d.sleepDebt)}h this week</em>}
            </span>
          </div>

          {/* trends */}
          <div className="hl-grid">
            <div className="hl-card">
              <div className="hl-cardhead"><TrendingUp className="size-3.5" /><h3>STEPS · 30 DAYS</h3><span className="hl-avg">avg {n0(d.averages.steps)}</span></div>
              <Bars series={d.series} pick={(x) => x.steps} goal={g?.steps} tint="#f4f5f7" />
            </div>
            <div className="hl-card">
              <div className="hl-cardhead"><Moon className="size-3.5" /><h3>SLEEP · 30 DAYS</h3><span className="hl-avg">avg {n1(d.averages.sleepHours)}h</span></div>
              <Bars series={d.series} pick={(x) => x.sleepHours} goal={g?.sleepHours} tint="#a855f7" />
            </div>
          </div>

          {/* insight: does rest track with output? */}
          {(d.correlations.sleepVsSolved || d.correlations.stepsVsSolved) && (
            <div className="hl-corr">
              <span className="lbl !text-[9px]">HOW YOUR BODY TRACKS YOUR OUTPUT</span>
              <div className="hl-corrrow">
                {d.correlations.sleepVsSolved && <CorrChip label="Sleep → LeetCode solved" c={d.correlations.sleepVsSolved} />}
                {d.correlations.stepsVsSolved && <CorrChip label="Steps → LeetCode solved" c={d.correlations.stepsVsSolved} />}
              </div>
            </div>
          )}

          {/* workouts */}
          <div className="hl-card">
            <div className="hl-cardhead">
              <Dumbbell className="size-3.5" /><h3>WORKOUTS</h3>
              <span className="hl-avg">{d.workoutsThisWeek} / {g?.workoutsPerWeek} this week</span>
            </div>
            <div className="hl-addform">
              <select value={wo.type} onChange={(e) => setWo({ ...wo, type: e.target.value })}>
                {WORKOUT_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <input type="number" placeholder="Minutes" value={wo.minutes} onChange={(e) => setWo({ ...wo, minutes: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addWorkout()} />
              <select value={wo.intensity} onChange={(e) => setWo({ ...wo, intensity: e.target.value })}>
                <option value="easy">easy</option><option value="moderate">moderate</option><option value="hard">hard</option>
              </select>
              <input type="number" placeholder="kcal (opt)" value={wo.kcal} onChange={(e) => setWo({ ...wo, kcal: e.target.value })} />
              <button onClick={addWorkout} disabled={busy || !wo.minutes} className="cc-btn cc-scan"><Plus className="size-3.5" /> Log</button>
            </div>
            {d.workouts.length > 0 ? (
              <div className="hl-wolist">
                {d.workouts.slice(0, 10).map((w) => (
                  <div key={w.id} className="hl-worow">
                    <span className={cn("hl-wodot", w.intensity)} />
                    <span className="hl-wotype">{w.type}</span>
                    <span className="hl-womin">{w.minutes} min</span>
                    <span className="hl-wokcal">{w.kcal ? `${w.kcal} kcal` : ""}</span>
                    <span className="hl-woday">{w.day.slice(5)}</span>
                    <button onClick={() => delWorkout(w.id)} className="cc-del" title="Remove"><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
              </div>
            ) : <p className="hl-empty">No workouts logged yet.</p>}
          </div>

          {/* manual entry */}
          <div className="hl-card">
            <div className="hl-cardhead"><Scale className="size-3.5" /><h3>LOG TODAY</h3><span className="hl-avg">or post from an iPhone Shortcut</span></div>
            <div className="hl-addform">
              <input type="number" placeholder="Steps" value={manual.steps} onChange={(e) => setManual({ ...manual, steps: e.target.value })} />
              <input type="number" step="0.1" placeholder="Sleep (h)" value={manual.sleepHours} onChange={(e) => setManual({ ...manual, sleepHours: e.target.value })} />
              <input type="number" placeholder="Active kcal" value={manual.activeKcal} onChange={(e) => setManual({ ...manual, activeKcal: e.target.value })} />
              <input type="number" placeholder="Resting HR" value={manual.restingHr} onChange={(e) => setManual({ ...manual, restingHr: e.target.value })} />
              <input type="number" step="0.1" placeholder="Weight (kg)" value={manual.weightKg} onChange={(e) => setManual({ ...manual, weightKg: e.target.value })} onKeyDown={(e) => e.key === "Enter" && logManual()} />
              <button onClick={logManual} disabled={busy} className="cc-btn cc-scan">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Record</button>
            </div>
            <p className="hl-hint">
              Shortcuts: POST your Health metrics as JSON to <code>/api/webhook/health?key=CRON_SECRET</code> — keys
              <code>steps</code>, <code>sleepHours</code>, <code>activeKcal</code>, <code>restingHr</code>, <code>weightKg</code>.
            </p>
          </div>

          {/* coach */}
          <div className="hl-card">
            <div className="hl-cardhead"><Sparkles className="size-3.5" /><h3>HEALTH COACH</h3></div>
            <div className="hl-ask">
              <input
                value={coachQ} onChange={(e) => setCoachQ(e.target.value)}
                placeholder="Ask about your body — 'am I sleeping enough?', 'why am I flat this week?'…"
                onKeyDown={(e) => e.key === "Enter" && coachQ.trim() && askCoach()}
              />
              <button onClick={() => askCoach()} disabled={coachBusy || !coachQ.trim()} className="cc-btn cc-scan">
                {coachBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </button>
            </div>
            <button onClick={() => askCoach("Give me my weekly health read and the one thing to fix")} disabled={coachBusy} className="hl-quickask">
              {coachBusy ? "Thinking…" : "Get my weekly read →"}
            </button>
            {coachA && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hl-answer">{coachA}</motion.div>}
          </div>
        </>
      )}
    </div>
  );
}

function Ring({ icon, label, value, sub, pct, tint }: { icon: React.ReactNode; label: string; value: string; sub: string; pct: number; tint: string }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className="hl-ring">
      <svg viewBox="0 0 64 64" className="hl-ringsvg">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="5" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke={tint} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
          transform="rotate(-90 32 32)" style={{ transition: "stroke-dashoffset .6s ease" }}
        />
      </svg>
      <div className="hl-ringtext">
        <span className="hl-ringico" style={{ color: tint }}>{icon}</span>
        <span className="hl-ringval">{value}</span>
        <span className="hl-ringlbl">{label}</span>
        <span className="hl-ringsub">{sub}</span>
      </div>
    </div>
  );
}

/**
 * Bar strip over a continuous day axis — every one of the last `days` gets a
 * slot whether or not it reported, so gaps read as gaps instead of silently
 * stretching a couple of readings across the whole window.
 */
function Bars({ series, pick, goal, tint, days = 30 }: { series: Day[]; pick: (d: Day) => number | null; goal?: number; tint: string; days?: number }) {
  const byDay = new Map(series.map((d) => [d.day, d]));
  const axis: { day: string; v: number | null }[] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const key = cursor.toISOString().slice(0, 10);
    const row = byDay.get(key);
    axis.push({ day: key, v: row ? pick(row) : null });
    cursor.setDate(cursor.getDate() + 1);
  }
  const max = Math.max(goal ?? 0, ...axis.map((a) => a.v).filter((v): v is number => v != null), 1);
  return (
    <div className="hl-bars">
      {axis.map(({ day, v }) => {
        const h = v == null ? 3 : Math.max(3, (v / max) * 100);
        const hit = goal != null && v != null && v >= goal;
        return (
          <span
            key={day}
            className="hl-bar"
            title={`${day}: ${v == null ? "no data" : v.toLocaleString()}`}
            style={{ height: `${h}%`, background: v == null ? "rgba(255,255,255,.06)" : hit ? tint : "rgba(255,255,255,.28)" }}
          />
        );
      })}
    </div>
  );
}

/** Correlation strength, phrased honestly — small samples say so. */
function CorrChip({ label, c }: { label: string; c: { r: number; n: number } }) {
  const a = Math.abs(c.r);
  const strength = a < 0.2 ? "no real link" : a < 0.4 ? "weak" : a < 0.6 ? "moderate" : "strong";
  const dir = c.r >= 0 ? "positive" : "negative";
  const weak = a < 0.2 || c.n < 10;
  return (
    <span className={cn("hl-corrchip", !weak && (c.r >= 0 ? "pos" : "neg"))}>
      {label}: <b>{strength}{a >= 0.2 ? ` ${dir}` : ""}</b>
      <i>r={c.r.toFixed(2)} · n={c.n}{c.n < 10 ? " (thin data)" : ""}</i>
    </span>
  );
}
