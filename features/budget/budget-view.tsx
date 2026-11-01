"use client";

/**
 * The budget, as a page.
 *
 * The engine for this already existed and had nowhere to live: plan,
 * 50/30/20 seeding, per-line status with projections, bucket rollups and
 * a cumulative spend curve, all reachable only through /api/budget and a
 * cramped panel on the portfolio page. Everything here reads that; none
 * of the arithmetic is redone in the client, because two implementations
 * of the same sum are two answers waiting to disagree.
 *
 * The page is built around one question — *am I going to overshoot* —
 * and everything is arranged by how directly it answers that:
 *
 *   1. LEFT TO SPEND, as the one big number, with the projection beside
 *      it. A total spent is history; what is left is a decision.
 *   2. THE CURVE: cumulative actual against the straight line of an even
 *      month. Above the line is overspending, and the gap at today is
 *      exactly how far. This is the only chart that answers the question
 *      directly, so it gets the width.
 *   3. THE LINES, sorted worst first. A budget page sorted alphabetically
 *      makes you read all of it to find the problem.
 *   4. BUCKETS, unbudgeted spend, and recurring commitments.
 *
 * Colour is spent where it means something: red for a line that is over
 * or heading over, green only for the savings bucket being met. Nothing
 * else is coloured, so the red actually reads as a warning.
 */

import { useCallback, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Wand2, Copy } from "lucide-react";
import { useLive } from "@/lib/live";
import { asArray } from "@/lib/as-array";
import {
  Donut, MonthHistogram, DailyBars, Radar, rupees as money, shadeFor,
  type Slice, type MonthBar, type Day, type Axis,
} from "./charts";
import "./budget.css";

type Bucket = "needs" | "wants" | "savings";

interface LineStatus {
  id: string; category: string; bucket: Bucket; limit: number;
  spent: number; remaining: number; usedPct: number; projected: number;
  state: "under" | "watch" | "over";
}
interface BucketStatus { bucket: Bucket; limit: number; spent: number; targetPct: number; actualPct: number }
interface Status {
  month: string; income: number; days: number; elapsed: number;
  lines: LineStatus[]; buckets: BucketStatus[];
  totalBudget: number; totalSpent: number;
  unbudgeted: { category: string; spent: number }[]; unbudgetedTotal: number;
  projectedTotal: number; leftToSpend: number; notes: string[];
}
interface Curve { day: number; spent: number; planned: number; future: boolean }
interface Analytics {
  months: MonthBar[];
  categories: { category: string; spent: number; pct: number }[];
  days: Day[];
  merchants: { merchant: string; spent: number; count: number }[];
  recurring: { merchant: string; spent: number; count: number }[];
  recurringTotal: number;
  medianMonth: number;
  thisMonthTotal: number;
}
interface Plan { month: string; income: number; basis: string; lines: LineStatus[] }

const rupees = money;

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" })
    .format(new Date(y, mo - 1, 1));
};

const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
};

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
};

/**
 * Cumulative spend against an even month.
 *
 * An area between the two lines rather than two lines: the GAP is the
 * reading, and two polylines make you measure it yourself. Above the
 * plan is filled; the future half of the plan line is dashed so a month
 * in progress does not look like a month that stopped.
 */
function SpendCurve({ curve, w = 920, h = 190 }: { curve: Curve[]; w?: number; h?: number }) {
  if (curve.length < 2) return <p className="bg-quiet">No days yet this month</p>;
  const pad = { l: 46, r: 12, t: 10, b: 20 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const top = Math.max(1, ...curve.map((c) => Math.max(c.spent, c.planned)));
  const x = (d: number) => pad.l + ((d - 1) / Math.max(1, curve.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - (v / top) * ih;

  const past = curve.filter((c) => !c.future);
  const spentLine = past.map((c) => `${x(c.day)},${y(c.spent)}`).join(" ");
  const planLine = curve.map((c) => `${x(c.day)},${y(c.planned)}`).join(" ");
  const last = past[past.length - 1];
  const over = last ? last.spent > last.planned : false;

  /* The band between actual and plan, closed back along the plan line. */
  const band = last
    ? `${past.map((c) => `${x(c.day)},${y(c.spent)}`).join(" ")} ` +
      `${[...past].reverse().map((c) => `${x(c.day)},${y(c.planned)}`).join(" ")}`
    : "";

  const ticks = [0, 0.5, 1].map((f) => ({ v: top * f, yy: y(top * f) }));

  return (
    <svg className="bg-curve" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
         role="img" aria-label="Cumulative spend against an even month">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={t.yy} x2={w - pad.r} y2={t.yy} className="bg-grid" />
          <text x={pad.l - 6} y={t.yy + 3} className="bg-axis" textAnchor="end">
            {t.v >= 1000 ? `${Math.round(t.v / 1000)}k` : Math.round(t.v)}
          </text>
        </g>
      ))}
      {band && <polygon points={band} className={over ? "bg-band over" : "bg-band under"} />}
      <polyline points={planLine} className="bg-plan" fill="none" vectorEffect="non-scaling-stroke" />
      <polyline points={spentLine} className="bg-spent" fill="none" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={x(last.day)} cy={y(last.spent)} r="3" className="bg-now" />}
      {curve.filter((c) => c.day % 7 === 0).map((c) => (
        <text key={c.day} x={x(c.day)} y={h - 6} className="bg-axis" textAnchor="middle">{c.day}</text>
      ))}
    </svg>
  );
}

export function BudgetView() {
  const [month, setMonth] = useState(thisMonth());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [curve, setCurve] = useState<Curve[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reachable, setReachable] = useState(true);
  const [an, setAn] = useState<Analytics | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /* Quick entry. Three fields, because a form that asks for more is a
     form he will not fill in at the counter. */
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [cat, setCat] = useState("food");
  const [cats, setCats] = useState<string[]>([]);
  const [income, setIncome] = useState("");

  const load = useCallback(async () => {
    /*
     * Twelve seconds, then say so.
     *
     * Both of these read the database, and when the database is the thing
     * that is wrong they do not fail — they hang. A page stuck on
     * "Reading the month…" forever is the worst of the three possible
     * states: it is indistinguishable from a page that is about to work,
     * so you wait instead of acting. Timed out and said plainly, it is a
     * fact you can do something with.
     */
    const [b, e, a] = await Promise.all([
      fetch(`/api/budget?month=${month}`, { signal: AbortSignal.timeout(12_000) })
        .then((r) => r.json()).catch(() => "unreachable" as const),
      fetch("/api/expenses", { signal: AbortSignal.timeout(12_000) })
        .then((r) => r.json()).catch(() => null),
      /* A year of expenses, so it is allowed longer and is never what
         keeps the headline numbers off the screen. */
      fetch(`/api/budget/analytics?month=${month}&months=12`, { signal: AbortSignal.timeout(20_000) })
        .then((r) => r.json()).catch(() => null),
    ]);
    setAn((a?.data as Analytics) ?? null);
    if (b === "unreachable") { setReachable(false); setLoaded(true); return; }
    setReachable(true);
    setPlan(b?.data?.plan ?? null);
    setStatus(b?.data?.status ?? null);
    setCurve(asArray<Curve>(b?.data?.curve));
    const known = asArray<string>(e?.data?.categories);
    if (known.length) { setCats(known); if (!known.includes(cat)) setCat(known[0]); }
    setLoaded(true);
    // `cat` is seeded from the response once; re-running on every keystroke
    // in the category box would fight the user for the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useLive(load, { everyMs: 120_000, scopes: ["expenses"] });

  const act = async (label: string, body: Record<string, unknown>) => {
    setBusy(label); setErr(null);
    const r = await fetch("/api/budget", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ month, ...body }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(null);
    if (!r?.ok) { setErr(r?.error ?? "That didn't go through"); return; }
    await load();
  };

  const logExpense = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setErr("Enter an amount"); return; }
    setBusy("log"); setErr(null);
    await fetch("/api/expenses", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amount: amt, merchant: merchant.trim() || "Cash",
        category: cat, date: new Date().toISOString(), recurring: false, source: "manual",
      }),
    }).catch(() => null);
    setBusy(null);
    setAmount(""); setMerchant("");
    await load();
  };

  /* Worst first. A budget page sorted alphabetically makes you read all
     of it to find the one line that is in trouble. */
  const lines = useMemo(
    () => [...(status?.lines ?? [])].sort((a, b) => b.usedPct - a.usedPct),
    [status],
  );

  /* Which categories are over, so the donut can mark exactly those and
     nothing else wears the accent. */
  const overBudget = useMemo(
    () => new Set((status?.lines ?? []).filter((l) => l.usedPct > 100).map((l) => l.category)),
    [status],
  );

  /* The five biggest LIMITS, not the five biggest spends: the radar is
     about how you are doing against the plan, and a category with no
     limit has no axis to be measured on. */
  const radarAxes = useMemo<Axis[]>(
    () => [...(status?.lines ?? [])]
      .filter((l) => l.limit > 0)
      .sort((a, b) => b.limit - a.limit)
      .slice(0, 5)
      .map((l) => ({ label: l.category, actual: l.spent, limit: l.limit })),
    [status],
  );

  const pace = status && status.elapsed > 0
    ? (status.totalSpent / status.elapsed) * status.days
    : 0;

  return (
    <div className="bg">
      {/* ── month and the headline ──────────────────────────────── */}
      <header className="bg-top">
        <div className="bg-month">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">‹</button>
          <h1>{monthLabel(month)}</h1>
          <button onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">›</button>
          {month !== thisMonth() && (
            <button className="bg-today" onClick={() => setMonth(thisMonth())}>This month</button>
          )}
        </div>

        {status && (
          <div className="bg-heads">
            <div className="bg-head">
              <span className="bg-k">Left to spend</span>
              <strong className={status.leftToSpend < 0 ? "over" : undefined}>
                {rupees(status.leftToSpend)}
              </strong>
              <span className="bg-sub">{status.days - status.elapsed} days left</span>
            </div>
            <div className="bg-head">
              <span className="bg-k">Spent</span>
              <strong>{rupees(status.totalSpent)}</strong>
              <span className="bg-sub">of {rupees(status.totalBudget)} budgeted</span>
            </div>
            <div className="bg-head">
              <span className="bg-k">On this pace</span>
              <strong className={pace > status.totalBudget ? "over" : undefined}>
                {rupees(pace)}
              </strong>
              <span className="bg-sub">
                {pace > status.totalBudget
                  ? `${rupees(pace - status.totalBudget)} over`
                  : `${rupees(status.totalBudget - pace)} under`}
              </span>
            </div>
          </div>
        )}
      </header>

      {err && <p className="bg-err" role="status">{err}</p>}

      {/* ── no plan yet ─────────────────────────────────────────── */}
      {loaded && reachable && !plan && (
        <section className="bg-seed">
          <h2>No plan for {monthLabel(month)}</h2>
          <p>
            Seed one from your income on the 50/30/20 rule — needs, wants,
            savings — then edit any line. Or copy last month&rsquo;s.
          </p>
          <div className="bg-seed-row">
            <input
              className="bg-in" inputMode="numeric" placeholder="Monthly income ₹"
              value={income} onChange={(e) => setIncome(e.target.value)}
              aria-label="Monthly income"
            />
            <button
              className="bg-btn primary"
              disabled={busy !== null || !Number(income)}
              onClick={() => act("seed", { action: "seed", income: Number(income) })}
            >
              {busy === "seed" ? <Loader2 className="size-3.5 bg-spin" /> : <Wand2 className="size-3.5" />}
              Seed 50/30/20
            </button>
            <button
              className="bg-btn"
              disabled={busy !== null}
              onClick={() => act("copy", { action: "copy", from: shiftMonth(month, -1) })}
            >
              {busy === "copy" ? <Loader2 className="size-3.5 bg-spin" /> : <Copy className="size-3.5" />}
              Copy {monthLabel(shiftMonth(month, -1)).split(" ")[0]}
            </button>
          </div>
        </section>
      )}

      {/* ── the curve ───────────────────────────────────────────── */}
      {plan && (
        <section className="bg-card bg-wide">
          <div className="bg-card-hd">
            <h2>Spend against an even month</h2>
            <span className="bg-legend">
              <i className="k-spent" /> actual
              <i className="k-plan" /> plan
            </span>
          </div>
          <SpendCurve curve={curve} />
          <p className="bg-note">
            The shaded gap is how far ahead of — or behind — an evenly paced
            month you are today.
          </p>
        </section>
      )}

      {/* ── where it goes ───────────────────────────────────────── */}
      {an && an.categories.length > 0 && (
        <section className="bg-card">
          <div className="bg-card-hd">
            <h2>Where it goes</h2>
            <span className="bg-sub">this month</span>
          </div>
          <Donut
            total={an.thisMonthTotal}
            slices={an.categories.map<Slice>((c) => ({
              label: c.category,
              value: c.spent,
              /* A category over its own line is the only slice allowed
                 the accent — everything else is ranked grey. */
              over: overBudget.has(c.category),
            }))}
          />
        </section>
      )}

      {/* ── budget as a shape ───────────────────────────────────── */}
      {radarAxes.length >= 3 && (
        <section className="bg-card">
          <div className="bg-card-hd">
            <h2>Against your limits</h2>
            <span className="bg-sub">biggest five</span>
          </div>
          {/*
            The radar plus its own table.
            A spider chart is a shape, and a shape tells you the pattern
            but never the number. The table beside it is the direct
            labelling the shape cannot carry — and it fills a card that
            was otherwise a small pentagon in a lot of black.
          */}
          <div className="bg-radar-wrap">
            <Radar axes={radarAxes} />
            <ul className="bg-rd-key">
              {radarAxes.map((a) => {
                const pct = a.limit > 0 ? (a.actual / a.limit) * 100 : 0;
                return (
                  <li key={a.label} className={pct > 100 ? "over" : undefined}>
                    <span className="k">{a.label}</span>
                    <span className="v num">{rupees(a.actual)}</span>
                    <span className="l num">/ {rupees(a.limit)}</span>
                    <b className="num">{Math.round(pct)}%</b>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* ── the year ────────────────────────────────────────────── */}
      {an && an.months.length > 1 && (
        <section className="bg-card bg-wide">
          <div className="bg-card-hd">
            <h2>Month by month</h2>
            <span className="bg-sub">
              {an.medianMonth > 0 ? `typical month ${rupees(an.medianMonth)}` : "building history"}
            </span>
          </div>
          <MonthHistogram months={an.months} median={an.medianMonth} />
        </section>
      )}

      {/* ── day by day ──────────────────────────────────────────── */}
      {an && an.days.length > 0 && (
        <section className="bg-card bg-wide">
          <div className="bg-card-hd">
            <h2>Day by day</h2>
            <span className="bg-sub">weekends marked · spikes outlined</span>
          </div>
          <DailyBars days={an.days} />
        </section>
      )}

      {/* ── who you paid ────────────────────────────────────────── */}
      {an && an.merchants.length > 0 && (
        <section className="bg-card">
          <div className="bg-card-hd"><h2>Biggest payees</h2></div>
          <div className="bg-rank">
            {an.merchants.map((m, i) => (
              <div className="bg-rank-row" key={m.merchant}>
                <span className="bg-rank-n num">{i + 1}</span>
                <span className="bg-rank-m">{m.merchant}</span>
                <span className="bg-rank-b">
                  <i style={{
                    width: `${(m.spent / Math.max(1, an.merchants[0].spent)) * 100}%`,
                    background: shadeFor(i),
                  }} />
                </span>
                <span className="bg-rank-v num">{rupees(m.spent)}</span>
                <span className="bg-rank-c num">×{m.count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── already committed ───────────────────────────────────── */}
      {an && an.recurring.length > 0 && (
        <section className="bg-card">
          <div className="bg-card-hd">
            <h2>Committed each month</h2>
            <span className="bg-sub num">{rupees(an.recurringTotal)}</span>
          </div>
          <p className="bg-note">
            Subscriptions and standing charges — the part of next month that is
            already decided.
          </p>
          <div className="bg-rank">
            {an.recurring.map((m, i) => (
              <div className="bg-rank-row" key={m.merchant}>
                <span className="bg-rank-n num">{i + 1}</span>
                <span className="bg-rank-m">{m.merchant}</span>
                <span className="bg-rank-b">
                  <i style={{
                    width: `${(m.spent / Math.max(1, an.recurring[0].spent)) * 100}%`,
                    background: shadeFor(i),
                  }} />
                </span>
                <span className="bg-rank-v num">{rupees(m.spent)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── quick entry ─────────────────────────────────────────── */}
      <section className="bg-card">
        <div className="bg-card-hd"><h2>Log an expense</h2></div>
        <div className="bg-quick">
          <input
            className="bg-in amt" inputMode="decimal" placeholder="₹"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") logExpense(); }}
            aria-label="Amount"
          />
          <input
            className="bg-in" placeholder="Where" value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") logExpense(); }}
            aria-label="Merchant"
          />
          <select className="bg-in" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            {(cats.length ? cats : ["food", "transport", "shopping", "bills", "other"]).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button className="bg-btn primary" onClick={logExpense} disabled={busy === "log"}>
            {busy === "log" ? <Loader2 className="size-3.5 bg-spin" /> : <Plus className="size-3.5" />}
            Log
          </button>
          {/* Scanning reads receipts out of Gmail. It costs a model call, so
              it is a button rather than something that happens on load. */}
          <button
            className="bg-btn"
            disabled={busy === "scan"}
            onClick={async () => {
              setBusy("scan"); setErr(null);
              const r = await fetch("/api/expenses", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "scan" }),
              }).then((x) => x.json()).catch(() => null);
              setBusy(null);
              if (r?.data) setErr(`Found ${r.data.added ?? 0} in your mail`);
              await load();
            }}
          >
            {busy === "scan" ? <Loader2 className="size-3.5 bg-spin" /> : <RefreshCw className="size-3.5" />}
            Scan mail
          </button>
        </div>
      </section>

      {/* ── the lines ───────────────────────────────────────────── */}
      {status && lines.length > 0 && (
        <section className="bg-card bg-wide">
          <div className="bg-card-hd">
            <h2>By category</h2>
            <span className="bg-sub">worst first</span>
          </div>
          <div className="bg-lines">
            {lines.map((l) => (
              <div className={`bg-line ${l.state}`} key={l.id}>
                <span className="bg-line-c">{l.category}</span>
                <span className="bg-line-b">
                  {/* The limit is the track; the fill is spend. A second,
                      lighter mark shows where this pace lands by month end,
                      which is the part you can still change. */}
                  <i className="fill" style={{ width: `${Math.min(100, l.usedPct)}%` }} />
                  {l.projected > l.limit && l.limit > 0 && (
                    <u className="proj" style={{ left: `${Math.min(99, (l.limit / Math.max(l.projected, 1)) * 100)}%` }} />
                  )}
                </span>
                <span className="bg-line-n num">{rupees(l.spent)}</span>
                <span className="bg-line-l num">/ {rupees(l.limit)}</span>
                <span className={`bg-line-p num ${l.state}`}>{Math.round(l.usedPct)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── buckets ─────────────────────────────────────────────── */}
      {status && status.buckets.length > 0 && (
        <section className="bg-card">
          <div className="bg-card-hd"><h2>Needs, wants, savings</h2></div>
          <div className="bg-buckets">
            {status.buckets.map((b) => (
              <div className="bg-bucket" key={b.bucket}>
                <span className="bg-bk">{b.bucket}</span>
                <span className="bg-btrack">
                  <i style={{ width: `${Math.min(100, b.actualPct)}%` }}
                     className={b.bucket === "savings" && b.actualPct >= b.targetPct ? "good" : undefined} />
                  {/* The target as a notch on the track, so "ahead" and
                      "behind" are a position rather than two numbers. */}
                  <u style={{ left: `${Math.min(100, b.targetPct)}%` }} />
                </span>
                <span className="bg-bn num">{Math.round(b.actualPct)}%</span>
                <span className="bg-bt num">target {Math.round(b.targetPct)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── what the plan does not know about ───────────────────── */}
      {status && status.unbudgeted.length > 0 && (
        <section className="bg-card">
          <div className="bg-card-hd">
            <h2>Unbudgeted</h2>
            <span className="bg-sub num">{rupees(status.unbudgetedTotal)}</span>
          </div>
          <p className="bg-note">Spend with no line in the plan. Add a line, or let it be.</p>
          <div className="bg-unb">
            {status.unbudgeted.map((u) => (
              <span className="bg-chip" key={u.category}>
                {u.category} <b className="num">{rupees(u.spent)}</b>
              </span>
            ))}
          </div>
        </section>
      )}

      {status && status.notes.length > 0 && (
        <section className="bg-card">
          <div className="bg-card-hd"><h2>Worth knowing</h2></div>
          <ul className="bg-notes">
            {status.notes.map((nt, i) => <li key={i}>{nt}</li>)}
          </ul>
        </section>
      )}

      {!loaded && <p className="bg-quiet">Reading the month…</p>}
      {loaded && !reachable && (
        <section className="bg-seed">
          <h2>Couldn&rsquo;t reach the budget</h2>
          <p>
            The database didn&rsquo;t answer in twelve seconds. Nothing here is
            wrong with your month — SAGE just could not read it.
          </p>
          <div className="bg-seed-row">
            <button className="bg-btn" onClick={() => { setLoaded(false); void load(); }}>
              <RefreshCw className="size-3.5" /> Try again
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
