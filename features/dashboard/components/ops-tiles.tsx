"use client";

import { useState } from "react";
import Link from "next/link";
import { Pane, Row, Stat, Empty } from "@/components/pane";
import { PaneForm } from "@/components/pane-form";
import { BarStrip, Progress } from "@/components/instruments";
import { useLive } from "@/lib/live";
import { asArray } from "@/lib/as-array";
import { TZ } from "@/lib/config";

/**
 * The second wall.
 *
 * Page one is the day: what is happening, what is owed, where he is. This is
 * the standing state underneath it — the practice, the money, the machinery
 * — and none of it moved off page one to get here. That was the decision:
 * nothing he already knows where to look for changes position.
 *
 * Same constraint as the first wall. Every pane reads an endpoint that
 * already exists; the density comes from showing what is known, not from
 * fetching more.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

function Go({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="pane-go" href={href}>{children}</Link>;
}

const dayName = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(new Date(iso)).toUpperCase();

/* ── 41 SKILLS ────────────────────────────────────────────────────────────
   Where each one is against where he wants it, and how long since it was
   touched. The gap is the useful number: a skill at 4/5 that has not been
   practised in a month is a different situation from one at 2/5 practised
   yesterday, and a bare level cannot tell them apart. */
interface Skill { id: string; name: string; category: string; level: number; target: number; lastPractisedAt?: string }

export function SkillsTile({ n }: { n?: number }) {
  const [skills, setSkills] = useState<Skill[] | null>(null);

  useLive(
    () => fetch("/api/skills").then((r) => r.json())
      .then((j) => setSkills(asArray<Skill>(j?.data))).catch(() => setSkills([])),
    { everyMs: 900_000 },
  );

  const rows = skills ?? [];
  const daysSince = (iso?: string) =>
    iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null;

  // Widest gap first — that is where the next hour should go.
  const ranked = [...rows].sort((a, b) => (b.target - b.level) - (a.target - a.level));

  return (
    <Pane
      n={n}
      title="Skills"
      status={<Go href="/education">{rows.length ? `${rows.length} TRACKED` : "…"}</Go>}
      live={rows.length > 0}
      edit={
        <PaneForm
          endpoint="/api/skills"
          submitLabel="TRACK"
          fields={[
            { name: "name", label: "Skill", required: true },
            { name: "category", label: "Category", placeholder: "DSA, Systems…" },
            { name: "level", label: "Level 0–5", type: "number", fallback: 0 },
            { name: "target", label: "Target 0–5", type: "number", fallback: 5 },
          ]}
        />
      }
    >
      {!skills && <div className="tile-wait">ACQUIRING…</div>}
      {skills?.length === 0 && <Empty reason="No skills tracked" action="Add one" href="/education" />}
      {ranked.slice(0, 7).map((s) => {
        const stale = daysSince(s.lastPractisedAt);
        return (
          <Row
            key={s.id}
            k={s.name}
            v={<>{s.level}/{s.target} <b className="sk-ago">{stale == null ? "NEVER" : stale === 0 ? "TODAY" : `${stale}D`}</b></>}
            tone={s.target - s.level >= 2 ? "signal" : undefined}
          />
        );
      })}
    </Pane>
  );
}

/* ── 42 BUDGET ────────────────────────────────────────────────────────────
   Envelopes against their limits.

   /api/budget has returned `status.lines` since the budget was built and
   nothing has ever displayed them — the dashboard showed one total, which is
   the number least likely to tell you anything, since it is the categories
   that go over. */
interface Line { category: string; limit: number; spent: number; usedPct: number; state?: string }

export function BudgetTile({ n }: { n?: number }) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [totals, setTotals] = useState<{ spent: number; budget: number } | null>(null);

  useLive(
    () => fetch("/api/budget").then((r) => r.json()).then((j) => {
      const st = j?.data?.status;
      setLines(asArray<Line>(st?.lines));
      setTotals(st?.totalSpent != null ? { spent: st.totalSpent, budget: st.totalBudget } : null);
    }).catch(() => setLines([])),
    { everyMs: 900_000 },
  );

  const rows = lines ?? [];
  // Nearest to blowing through first: an envelope at 96% is the one that
  // needs a decision, and sorting alphabetically buries it.
  const ranked = [...rows].sort((a, b) => b.usedPct - a.usedPct);

  return (
    <Pane
      n={n}
      title="Budget"
      status={<Go href="/portfolio">{totals ? "THIS MONTH" : "…"}</Go>}
      live={!!totals}
      edit={
        <PaneForm
          endpoint="/api/budget"
          submitLabel="SET"
          extra={{ action: "save" }}
          fields={[
            { name: "category", label: "Envelope", required: true },
            { name: "limit", label: "Limit ₹", type: "number", required: true },
          ]}
        />
      }
    >
      {!lines && <div className="tile-wait">ACQUIRING…</div>}
      {lines?.length === 0 && <Empty reason="No budget set" action="Plan a month" href="/portfolio" />}
      {totals && (
        <Progress
          pct={totals.budget > 0 ? totals.spent / totals.budget : 0}
          left={rupees(totals.spent)}
          right={rupees(totals.budget)}
        />
      )}
      {ranked.slice(0, 6).map((l) => (
        <Row
          key={l.category}
          k={l.category}
          v={`${Math.min(999, l.usedPct)}%`}
          tone={l.usedPct >= 100 ? "down" : l.usedPct >= 85 ? "signal" : undefined}
        />
      ))}
    </Pane>
  );
}

/* ── 43 DECISIONS ─────────────────────────────────────────────────────────
   Calls made and not yet scored.

   A decision log only teaches you anything if the outcomes get written down,
   and the ones due for review are exactly the ones nobody remembers to go
   back to. This is the nagging half of the loop. */
interface Decision { id: string; title: string; confidence?: number; reviewAt?: string }

export function DecisionsTile({ n }: { n?: number }) {
  const [due, setDue] = useState<Decision[] | null>(null);
  const [pending, setPending] = useState<number>(0);

  useLive(
    () => fetch("/api/decisions").then((r) => r.json()).then((j) => {
      setDue(asArray<Decision>(j?.data?.due));
      setPending(Number(j?.data?.calibration?.pending ?? 0));
    }).catch(() => setDue([])),
    { everyMs: 900_000 },
  );

  const rows = due ?? [];

  return (
    <Pane
      n={n}
      title="Decisions"
      status={<Go href="/decisions">{pending ? `${pending} OPEN` : "…"}</Go>}
      live={rows.length > 0}
      edit={
        /* Confidence is asked for at the time of the call, not later. A number
           recalled after the outcome is known is not a forecast, and the whole
           calibration pane is built on it being one. */
        <PaneForm
          endpoint="/api/decisions"
          submitLabel="LOG"
          fields={[
            { name: "title", label: "The call", required: true },
            { name: "confidence", label: "Confidence %", type: "number", required: true },
            { name: "reviewAt", label: "Review on", type: "date" },
          ]}
        />
      }
    >
      {!due && <div className="tile-wait">ACQUIRING…</div>}
      {due?.length === 0 && pending === 0 && <Empty reason="Nothing logged" action="Log a call" href="/decisions" />}
      {due?.length === 0 && pending > 0 && <Empty reason="None due for review" action="See open calls" href="/decisions" />}
      {rows.slice(0, 6).map((d) => (
        <Row
          key={d.id}
          k={d.title}
          v={d.confidence != null ? `${Math.round(d.confidence * 100)}%` : "—"}
          tone="signal"
        />
      ))}
    </Pane>
  );
}

/* ── 44 WEATHER WEEK ──────────────────────────────────────────────────────
   The hours ahead, as a shape.

   The dashboard has today's temperature; this is whether tomorrow is worse.
   A single number cannot answer "should I go now or later", and that is the
   only question the weather is ever asked here. */
interface Weather { place: string; temp: number; high: number; low: number; label: string; hourly?: { temp: number[] } }

export function WeatherWeekTile({ n }: { n?: number }) {
  const [w, setW] = useState<Weather | null>(null);

  useLive(
    () => fetch("/api/weather").then((r) => r.json()).then((j) => setW(j?.data ?? null)).catch(() => {}),
    { everyMs: 900_000 },
  );

  const hours = asArray<number>(w?.hourly?.temp);

  return (
    <Pane n={n} title="Outside" status={w?.place?.toUpperCase() ?? "…"} live={!!w}>
      {!w && <div className="tile-wait">ACQUIRING…</div>}
      {w && (
        <>
          <div className="tstat">
            <span className="tstat-v">{w.temp}°</span>
            <span className="tstat-k">{w.label.toUpperCase()}</span>
          </div>
          <Row k="High / low" v={`${w.high}° / ${w.low}°`} />
          {hours.length > 1 && (
            <>
              <div className="tile-cap">NEXT {Math.min(hours.length, 24)}H</div>
              <BarStrip data={hours.slice(0, 24)} height={30} />
            </>
          )}
        </>
      )}
    </Pane>
  );
}

/* ── 45 MACHINERY ─────────────────────────────────────────────────────────
   Whether the parts of SAGE that run without being asked are still running.
   A backup that stopped four weeks ago is invisible until the day it is the
   only thing that matters, so its age is the reading, not its existence. */
export function MachineryTile({ n }: { n?: number }) {
  const [backup, setBackup] = useState<{ ageDays: number; rows: number } | null | undefined>(undefined);
  const [runs, setRuns] = useState<{ createdAt: string; status?: string }[] | null>(null);

  useLive(
    () => fetch("/api/backup").then((r) => r.json())
      .then((j) => setBackup(j?.data?.last ?? null)).catch(() => setBackup(null)),
    { everyMs: 900_000 },
  );
  useLive(
    () => fetch("/api/agent/runs").then((r) => r.json())
      .then((j) => setRuns(asArray<{ createdAt: string; status?: string }>(j?.data))).catch(() => setRuns([])),
    { everyMs: 300_000 },
  );

  return (
    <Pane n={n} title="Machinery" status={<Go href="/settings">AUTONOMY</Go>} live={!!runs?.length}>
      <Row
        k="Last backup"
        v={backup ? (backup.ageDays === 0 ? "TODAY" : `${backup.ageDays}D AGO`) : "NEVER"}
        tone={!backup || backup.ageDays > 7 ? "down" : backup.ageDays > 2 ? "signal" : "up"}
      />
      {backup && <Row k="Rows held" v={backup.rows.toLocaleString("en-IN")} tone="muted" />}
      <Row k="Agent runs" v={runs ? String(runs.length) : "…"} />
      {runs?.[0]?.createdAt && <Row k="Last run" v={dayName(runs[0].createdAt)} tone="muted" />}
      {backup === null && <Empty reason="No backup has ever run" action="Set BACKUP_REPO" href="/settings" />}
    </Pane>
  );
}

/* ── 46 MODEL LOAD ────────────────────────────────────────────────────────
   Calls to the language models, per day, and how many failed.

   This runs on free tiers, so the shape of this bar chart is the difference
   between "SAGE is quiet today" and "SAGE has been rate-limited since
   Tuesday". The failure count is the half that matters and the half nothing
   has ever shown. */
export function ModelLoadTile({ n }: { n?: number }) {
  const [usage, setUsage] = useState<{ day: string; calls: number; failures: number }[] | null>(null);

  useLive(
    () => fetch("/api/vitals").then((r) => r.json())
      .then((j) => setUsage(asArray<{ day: string; calls: number; failures: number }>(j?.data?.usage)))
      .catch(() => setUsage([])),
    { everyMs: 300_000 },
  );

  // The endpoint returns newest first; a chart reads left to right in time.
  const rows = [...(usage ?? [])].reverse();
  const calls = rows.reduce((a, r) => a + r.calls, 0);
  const fails = rows.reduce((a, r) => a + r.failures, 0);

  return (
    <Pane n={n} title="Model Load" status={<Go href="/settings">7 DAYS</Go>} live={calls > 0}>
      {!usage && <div className="tile-wait">ACQUIRING…</div>}
      {usage?.length === 0 && <Empty reason="No model calls recorded" action="Ask Sage something" href="/chat" />}
      {rows.length > 0 && (
        <>
          <div className="tstat">
            <span className="tstat-v">{calls.toLocaleString("en-IN")}</span>
            <span className="tstat-k">CALLS · 7 DAYS</span>
          </div>
          <BarStrip data={rows.map((r) => r.calls)} height={30} />
          <Row k="Failures" v={String(fails)} tone={fails > 0 ? "down" : "up"} />
          <Row k="Today" v={String(rows[rows.length - 1]?.calls ?? 0)} tone="muted" />
        </>
      )}
    </Pane>
  );
}

/* ── 47 KEYS ──────────────────────────────────────────────────────────────
   Which model providers are actually usable.

   Page one's Key Metrics shows the ratio; this shows which one is down,
   because "3/4" tells you something is wrong and nothing about what to
   replace. */
interface KeyStatus { provider?: string; label?: string; healthy: boolean }

export function KeysTile({ n }: { n?: number }) {
  const [keys, setKeys] = useState<KeyStatus[] | null>(null);

  useLive(
    () => fetch("/api/vitals").then((r) => r.json())
      .then((j) => setKeys(asArray<KeyStatus>(j?.data?.keys))).catch(() => setKeys([])),
    { everyMs: 300_000 },
  );

  const rows = keys ?? [];
  const bad = rows.filter((k) => !k.healthy).length;

  return (
    <Pane
      n={n}
      title="Keys"
      status={<Go href="/settings">{rows.length ? `${rows.length - bad}/${rows.length}` : "…"}</Go>}
      live={rows.length > 0 && bad === 0}
      alert={bad > 0 ? "danger" : undefined}
    >
      {!keys && <div className="tile-wait">ACQUIRING…</div>}
      {keys?.length === 0 && <Empty reason="No model keys" action="Add one" href="/settings" />}
      {rows.map((k, i) => (
        <Row
          key={i}
          k={k.label ?? k.provider ?? `KEY ${pad(i + 1)}`}
          v={k.healthy ? "OK" : "FAILING"}
          tone={k.healthy ? "up" : "down"}
        />
      ))}
    </Pane>
  );
}

export { pad };
