"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The budget: what you meant the money to do, next to what it did.
 *
 * The expense list already answers "where did it go". On its own that is a
 * post-mortem. Putting a plan beside it — and pacing both against the day of
 * the month — turns it into something you can still act on, which is the only
 * reason to keep a budget at all.
 *
 * 50/30/20 seeds a plan; every line is then editable, because a rule of thumb
 * invented for a different country's salaries is a first guess and nothing more.
 */

type Bucket = "needs" | "wants" | "savings";

interface Line { id: string; category: string; bucket: Bucket; limit: number }
interface LineStatus extends Line {
  spent: number; remaining: number; usedPct: number; projected: number;
  state: "under" | "watch" | "over";
}
interface Status {
  month: string; income: number; days: number; elapsed: number;
  lines: LineStatus[];
  buckets: { bucket: Bucket; limit: number; spent: number; targetPct: number; actualPct: number }[];
  totalBudget: number; totalSpent: number;
  unbudgeted: { category: string; spent: number }[];
  unbudgetedTotal: number; projectedTotal: number; leftToSpend: number;
  notes: string[];
}
interface Plan { month: string; income: number; basis: "50-30-20" | "custom"; lines: Line[] }
interface Point { day: number; spent: number; planned: number; future: boolean }

const BUCKETS: Bucket[] = ["needs", "wants", "savings"];
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const STATE_COLOUR: Record<LineStatus["state"], string> = {
  under: "var(--live)",
  watch: "#e8a13a",
  over: "#f87171",
};

function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}
function shiftMonth(m: string, by: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function BudgetPanel({ reloadKey }: { reloadKey?: number }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [curve, setCurve] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [seedIncome, setSeedIncome] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true); setErr(null);
    const j = await fetch(`/api/budget?month=${m}`).then((r) => r.json()).catch(() => null);
    setLoading(false);
    if (!j?.ok) { setErr("Couldn't load the budget."); return; }
    setPlan(j.data.plan);
    setStatus(j.data.status);
    setCurve(j.data.curve ?? []);
    setDirty(false);
  }, []);
  useEffect(() => { void load(month); }, [load, month, reloadKey]);

  const seed = async () => {
    setSaving(true); setErr(null);
    const j = await fetch("/api/budget", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "seed", month, income: Number(seedIncome) || 0 }),
    }).then((r) => r.json()).catch(() => null);
    setSaving(false);
    if (!j?.ok) { setErr(j?.error ?? "Couldn't create that plan."); return; }
    await load(month);
  };

  const copyLast = async () => {
    setSaving(true); setErr(null);
    const j = await fetch("/api/budget", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "copy", month, from: shiftMonth(month, -1) }),
    }).then((r) => r.json()).catch(() => null);
    setSaving(false);
    if (!j?.ok) { setErr(j?.error ?? "Nothing to copy."); return; }
    await load(month);
  };

  const save = async () => {
    if (!plan) return;
    setSaving(true); setErr(null);
    const j = await fetch("/api/budget", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ month, income: plan.income, basis: "custom", lines: plan.lines }),
    }).then((r) => r.json()).catch(() => null);
    setSaving(false);
    if (!j?.ok) { setErr(j?.error ?? "Save failed."); return; }
    await load(month);
  };

  const patchLine = (id: string, patch: Partial<Line>) => {
    setPlan((p) => (p ? { ...p, lines: p.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : p));
    setDirty(true);
  };
  const addLine = (category = "", bucket: Bucket = "wants") => {
    setPlan((p) => (p ? { ...p, lines: [...p.lines, { id: crypto.randomUUID(), category, bucket, limit: 0 }] } : p));
    setDirty(true);
  };
  const removeLine = (id: string) => {
    setPlan((p) => (p ? { ...p, lines: p.lines.filter((l) => l.id !== id) } : p));
    setDirty(true);
  };

  // Status reflects the last SAVED plan, so while editing the figures beside
  // each row would be stale. Match by id and fall back to zero rather than
  // showing another line's numbers.
  const spentFor = useMemo(() => {
    const m = new Map<string, LineStatus>();
    for (const l of status?.lines ?? []) m.set(l.id, l);
    return m;
  }, [status]);

  const planned = status?.totalBudget ?? 0;

  return (
    <div className="pp-card mt-4">
      <div className="pp-head">
        <Wallet className="size-3.5" /><h3>BUDGET</h3><span className="pp-line" />
        <button className="bg-navbtn" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
        <span className="pp-tag">{monthLabel(month)}</span>
        <button className="bg-navbtn" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
      </div>

      {loading && !plan && <p className="pp-dim"><Loader2 className="inline size-3 animate-spin" /> loading…</p>}
      {err && <p className="bg-err">{err}</p>}

      {/* No plan for this month yet */}
      {!loading && !plan && (
        <div className="bg-seed">
          <p className="pp-dim">
            No budget for {monthLabel(month)}. Start from the 50/30/20 rule — half on needs,
            a third on wants, a fifth saved — then edit every line to suit.
          </p>
          <div className="bg-seedrow">
            <label className="bg-lbl">MONTHLY INCOME</label>
            <input
              className="bg-input"
              inputMode="numeric"
              value={seedIncome}
              onChange={(e) => setSeedIncome(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="e.g. 60000"
            />
            <button className="bg-btn primary" onClick={seed} disabled={saving || !seedIncome}>
              {saving ? <Loader2 className="size-3 animate-spin" /> : "CREATE PLAN"}
            </button>
            <button className="bg-btn" onClick={copyLast} disabled={saving}>
              COPY {monthLabel(shiftMonth(month, -1)).split(" ")[0].toUpperCase()}
            </button>
          </div>
        </div>
      )}

      {plan && (
        <>
          {/* headline numbers */}
          {status && (
            <div className="pp-metrics">
              <Metric k="INCOME" v={inr(status.income)} sub={`day ${status.elapsed} of ${status.days}`} />
              <Metric k="PLANNED" v={inr(status.totalBudget)} sub={status.income ? `${Math.round((status.totalBudget / status.income) * 100)}% of income` : "—"} />
              <Metric
                k="SPENT"
                v={inr(status.totalSpent)}
                sub={planned ? `${Math.round((status.totalSpent / planned) * 100)}% of plan` : "—"}
                tone={status.totalSpent > planned ? "warn" : undefined}
              />
              <Metric
                k="ON PACE FOR"
                v={inr(status.projectedTotal)}
                sub="at this rate"
                tone={status.projectedTotal > planned ? "warn" : undefined}
              />
            </div>
          )}

          {/* spend vs an even month */}
          {curve.length > 0 && <Curve points={curve} />}

          {/* buckets */}
          {status && (
            <div className="bg-buckets">
              {BUCKETS.map((b) => {
                const s = status.buckets.find((x) => x.bucket === b);
                if (!s) return null;
                const pct = s.limit > 0 ? Math.min(140, (s.spent / s.limit) * 100) : 0;
                return (
                  <div className="bg-bucket" key={b}>
                    <div className="bg-bkhead">
                      <span className="bg-bkname">{b}</span>
                      <span className="bg-bkpct">{s.targetPct}%</span>
                    </div>
                    <div className="bg-bkbar">
                      <i style={{ width: `${Math.min(100, pct)}%`, background: pct > 100 ? STATE_COLOUR.over : STATE_COLOUR.under }} />
                    </div>
                    <div className="bg-bkfoot">{inr(s.spent)} <span>/ {inr(s.limit)}</span></div>
                  </div>
                );
              })}
            </div>
          )}

          {/* the editable table */}
          <div className="bg-table">
            <div className="bg-row bg-hdr">
              <span>CATEGORY</span><span>BUCKET</span><span>BUDGET</span><span>SPENT</span><span>LEFT</span><span />
            </div>
            {plan.lines.map((l) => {
              const st = spentFor.get(l.id);
              return (
                <div className="bg-row" key={l.id}>
                  <input
                    className="bg-cell"
                    value={l.category}
                    onChange={(e) => patchLine(l.id, { category: e.target.value })}
                    placeholder="name"
                  />
                  <select
                    className="bg-cell bg-select"
                    value={l.bucket}
                    onChange={(e) => patchLine(l.id, { bucket: e.target.value as Bucket })}
                  >
                    {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <input
                    className="bg-cell bg-num"
                    inputMode="numeric"
                    value={l.limit || ""}
                    onChange={(e) => patchLine(l.id, { limit: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
                    placeholder="0"
                  />
                  <span className="bg-cell bg-ro">{st ? inr(st.spent) : "—"}</span>
                  <span
                    className="bg-cell bg-ro"
                    style={{ color: st ? STATE_COLOUR[st.state] : undefined }}
                    title={st ? `On pace for ${inr(st.projected)} by month end` : undefined}
                  >
                    {st ? inr(st.remaining) : "—"}
                  </span>
                  <button className="bg-del" onClick={() => removeLine(l.id)} aria-label="Remove"><Trash2 className="size-3" /></button>
                </div>
              );
            })}
          </div>

          <div className="bg-actions">
            <button className="bg-btn" onClick={() => addLine()}><Plus className="size-3" /> ADD LINE</button>
            <label className="bg-lbl" style={{ marginLeft: "auto" }}>INCOME</label>
            <input
              className="bg-input"
              inputMode="numeric"
              value={plan.income || ""}
              onChange={(e) => { setPlan((p) => (p ? { ...p, income: Number(e.target.value.replace(/[^\d]/g, "")) || 0 } : p)); setDirty(true); }}
            />
            <button className="bg-btn primary" onClick={save} disabled={saving || !dirty}>
              {saving ? <Loader2 className="size-3 animate-spin" /> : dirty ? "SAVE" : <><Check className="size-3" /> SAVED</>}
            </button>
          </div>

          {/* spending the plan never accounted for */}
          {status && status.unbudgeted.length > 0 && (
            <div className="bg-unbudgeted">
              <span className="pp-mk">NOT IN THE PLAN</span>
              {status.unbudgeted.map((u) => (
                <button
                  key={u.category}
                  className="bg-unrow"
                  title="Add a line for this category"
                  onClick={() => addLine(u.category, "wants")}
                >
                  <Plus className="size-3" /> {u.category} <b>{inr(u.spent)}</b>
                </button>
              ))}
            </div>
          )}

          {status && status.notes.length > 0 && (
            <div className="pp-warns">
              {status.notes.map((n, i) => (
                <div className="pp-warn" key={i}><AlertTriangle className="size-3.5" /> {n}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Cumulative spend against a straight-line budget.
 *
 * Two totals tell you less than two curves: the moment they cross is the thing
 * worth seeing, and a flat month and a spike-on-the-3rd month can share a total
 * while meaning completely different things.
 */
function Curve({ points }: { points: Point[] }) {
  const W = 100, H = 34;
  const max = Math.max(1, ...points.map((p) => Math.max(p.spent, p.planned)));
  const x = (d: number) => ((d - 1) / Math.max(1, points.length - 1)) * W;
  const y = (v: number) => H - (v / max) * H;

  const real = points.filter((p) => !p.future);
  const line = (pts: Point[], pick: (p: Point) => number) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(2)},${y(pick(p)).toFixed(2)}`).join(" ");

  const last = real.at(-1);
  const over = !!last && last.spent > last.planned;

  return (
    <div className="bg-curve">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Spend against plan">
        {/* The even-month pace: where a perfectly steady month would be. */}
        <path d={line(points, (p) => p.planned)} fill="none" stroke="var(--border-glass-strong)" strokeWidth="0.6" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        {/* Actual spend, only for days that have happened. */}
        <path d={line(real, (p) => p.spent)} fill="none" stroke={over ? "#f87171" : "var(--live)"} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="bg-curvefoot">
        <span><i className="bg-key live" /> spent</span>
        <span><i className="bg-key dash" /> even pace</span>
        {last && <span className="bg-curvenow">{inr(last.spent)} by day {last.day}</span>}
      </div>
    </div>
  );
}

function Metric({ k, v, sub, tone }: { k: string; v: string; sub: string; tone?: "warn" }) {
  return (
    <div className={cn("pp-metric", tone)}>
      <span className="pp-mk">{k}</span>
      <span className="pp-mv">{v}</span>
      <span className="pp-ms">{sub}</span>
    </div>
  );
}
