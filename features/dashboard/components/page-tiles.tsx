"use client";

import { useState } from "react";
import Link from "next/link";
import { Pane, Row } from "@/components/pane";
import { BarStrip, BarRows, Ring, Matrix, Progress, Delta } from "@/components/instruments";
import { useLive } from "@/lib/live";
import { TZ } from "@/lib/config";

/**
 * A pane for every page.
 *
 * The dashboard is the terminal; the other screens are where you go to work on
 * one thing. Each of these is the glanceable half of a page — the number you
 * would open it to check — with the page itself one click away on the title.
 *
 * All of them sit on routes that already exist. Nothing here adds an upstream:
 * the density comes from showing what SAGE already knows, tightly.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(iso));

/** Panes are addressable and their titles are doors. */
function Go({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="pane-go" href={href}>{children}</Link>;
}

/* ── SIGNALS · /sitrep ────────────────────────────────────────────────── */
export function SignalsTile({ n }: { n?: number }) {
  const [alerts, setAlerts] = useState<{ level: string; icon: string; text: string }[] | null>(null);
  useLive(
    () => fetch("/api/sitrep").then((r) => r.json()).then((j) => setAlerts(j?.data?.alerts ?? [])).catch(() => setAlerts([])),
    { everyMs: 60_000, scopes: ["tasks", "events"] },
  );
  return (
    <Pane n={n} title="Signals" status={<Go href="/sitrep">{alerts ? `${pad(alerts.length)} OPEN` : "…"}</Go>} live={!!alerts?.length}>
      {!alerts && <div className="tile-wait">ACQUIRING…</div>}
      {alerts?.length === 0 && <div className="tile-wait">ALL QUIET</div>}
      {alerts?.slice(0, 6).map((a, i) => (
        <div className={`sig-row ${a.level}`} key={i}>
          <span className="sg-i">{a.icon}</span>
          <span className="sg-t">{a.text}</span>
        </div>
      ))}
    </Pane>
  );
}

/* ── AGENT LOG · /agents ──────────────────────────────────────────────── */
export function AgentLogTile({ n }: { n?: number }) {
  const [runs, setRuns] = useState<{ id: string; kind: string; input: string; status: string; createdAt: string }[] | null>(null);
  useLive(
    () => fetch("/api/agent/runs?limit=12").then((r) => r.json()).then((j) => setRuns(j?.data ?? [])).catch(() => setRuns([])),
    { everyMs: 120_000, scopes: ["agent"] },
  );
  return (
    <Pane n={n} title="Agent Log" status={<Go href="/agents">{runs ? `${pad(runs.length)} RUNS` : "…"}</Go>} live={!!runs?.length}>
      {!runs && <div className="tile-wait">ACQUIRING…</div>}
      {runs?.length === 0 && <div className="tile-wait">NO RUNS YET</div>}
      {runs?.map((r) => (
        <div className="log-row" key={r.id}>
          <span className="lg-t">{hhmm(r.createdAt)}</span>
          <span className="lg-k">{r.kind}</span>
          <span className="lg-i">{r.input}</span>
          <span className={`lg-s ${r.status === "done" ? "ok" : "bad"}`}>{r.status === "done" ? "OK" : r.status.toUpperCase()}</span>
        </div>
      ))}
    </Pane>
  );
}

/* ── GITHUB · /push ───────────────────────────────────────────────────── */
export function GithubTile({ n }: { n?: number }) {
  const [days, setDays] = useState<{ date: string; count: number; level: number }[] | null>(null);
  useLive(
    () => fetch("/api/github/contributions").then((r) => r.json())
      .then((j) => setDays(j?.data?.days ?? j?.data ?? [])).catch(() => setDays([])),
    { everyMs: 900_000 },
  );
  const recent = (days ?? []).slice(-182);
  const total = recent.reduce((s, d) => s + (d.count ?? 0), 0);
  return (
    <Pane n={n} title="Commits" status={<Go href="/push">{days ? `${total} · 26W` : "…"}</Go>}>
      {!days && <div className="tile-wait">ACQUIRING…</div>}
      {days?.length === 0 && <div className="tile-wait">NO CONTRIBUTION DATA</div>}
      {recent.length > 0 && (
        <Matrix
          cols={26}
          cells={recent.map((d) => ({ level: d.level ?? 0, title: `${d.date} · ${d.count ?? 0}` }))}
        />
      )}
    </Pane>
  );
}

/* ── BIOMETRICS · /health ─────────────────────────────────────────────── */
interface Vitals { bpm?: number; hrv?: number; sleepMin?: number; steps?: number; calories?: number; recovery?: number; load?: number[] }

export function BioTile({ n }: { n?: number }) {
  const [v, setV] = useState<Vitals | null>(null);
  useLive(
    () => fetch("/api/health").then((r) => r.json()).then((j) => setV(j?.data ?? null)).catch(() => {}),
    { everyMs: 300_000, scopes: ["health"] },
  );
  const sleep = v?.sleepMin ? `${Math.floor(v.sleepMin / 60)}H${pad(v.sleepMin % 60)}` : "—";
  return (
    <Pane n={n} title="Biometrics" status={<Go href="/health">{v ? "SYNCED" : "…"}</Go>} live={!!v}>
      {!v && <div className="tile-wait">NO RECENT READING</div>}
      {v && (
        <>
          <div className="bio-figs">
            <span><b>{v.bpm ?? "—"}</b><i>BPM</i></span>
            <span><b>{v.hrv ?? "—"}</b><i>HRV</i></span>
            <span><b>{sleep}</b><i>SLEEP</i></span>
            <span><b>{v.steps != null ? (v.steps / 1000).toFixed(1) + "K" : "—"}</b><i>STEPS</i></span>
          </div>
          {typeof v.recovery === "number" && (
            <Ring pct={v.recovery / 100} value={`${Math.round(v.recovery)}%`} label="RECOVERY" />
          )}
          {v.load?.length ? <BarStrip data={v.load} height={26} /> : null}
        </>
      )}
    </Pane>
  );
}

/* ── PORTFOLIO · /portfolio ───────────────────────────────────────────── */
export function PortfolioTile({ n }: { n?: number }) {
  const [p, setP] = useState<{ total?: number; changePct?: number; curve?: number[]; holdings?: { symbol: string; value: number }[] } | null>(null);
  useLive(
    () => fetch("/api/portfolio").then((r) => r.json()).then((j) => setP(j?.data ?? null)).catch(() => {}),
    { everyMs: 300_000 },
  );
  return (
    <Pane n={n} title="Portfolio" status={<Go href="/portfolio">{p?.total != null ? "LIVE" : "…"}</Go>} live={p?.total != null}>
      {!p && <div className="tile-wait">ACQUIRING…</div>}
      {p && p.total == null && <div className="tile-wait">NO HOLDINGS</div>}
      {p?.total != null && (
        <>
          <div className="tstat">
            <span className="tstat-v">₹{Math.round(p.total).toLocaleString("en-IN")}</span>
            <span className="tstat-k">TOTAL VALUE</span>
          </div>
          {typeof p.changePct === "number" && (
            <Row k="Today" v={<Delta pct={p.changePct} />} />
          )}
          {p.curve?.length ? <BarStrip data={p.curve} height={30} /> : null}
          {p.holdings?.slice(0, 5).map((h) => (
            <Row key={h.symbol} k={h.symbol} v={`₹${Math.round(h.value).toLocaleString("en-IN")}`} />
          ))}
        </>
      )}
    </Pane>
  );
}

/* ── MEMORY · /memory ─────────────────────────────────────────────────── */
export function MemoryTile({ n }: { n?: number }) {
  const [m, setM] = useState<{ total?: number; recent?: { text: string; createdAt: string }[] } | null>(null);
  useLive(
    () => fetch("/api/memory?limit=6").then((r) => r.json())
      .then((j) => setM({ total: j?.data?.total, recent: j?.data?.items ?? j?.data ?? [] })).catch(() => {}),
    { everyMs: 300_000, scopes: ["memory"] },
  );
  return (
    <Pane n={n} title="Memory" status={<Go href="/memory">{m?.total != null ? `${m.total} HELD` : "…"}</Go>}>
      {!m && <div className="tile-wait">ACQUIRING…</div>}
      {m?.recent?.length === 0 && <div className="tile-wait">NOTHING STORED</div>}
      {m?.recent?.slice(0, 6).map((r, i) => (
        <div className="mem-row" key={i}>
          <span className="mm-n">{pad(i + 1)}</span>
          <span className="mm-t">{r.text}</span>
        </div>
      ))}
    </Pane>
  );
}

/* ── EXAMS · /exam ────────────────────────────────────────────────────── */
export function ExamTile({ n }: { n?: number }) {
  const [ex, setEx] = useState<{ name: string; date: string }[] | null>(null);
  useLive(
    () => fetch("/api/exam").then((r) => r.json()).then((j) => setEx(j?.data?.exams ?? j?.data ?? [])).catch(() => setEx([])),
    { everyMs: 3_600_000 },
  );
  const daysTo = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return (
    <Pane n={n} title="Exams" status={<Go href="/exam">{ex ? `${pad(ex.length)}` : "…"}</Go>}>
      {!ex && <div className="tile-wait">ACQUIRING…</div>}
      {ex?.length === 0 && <div className="tile-wait">NONE SCHEDULED</div>}
      {ex?.slice(0, 5).map((e, i) => {
        const d = daysTo(e.date);
        return <Row key={i} k={e.name} v={`${d}D`} tone={d <= 7 ? "down" : d <= 21 ? "signal" : undefined} />;
      })}
    </Pane>
  );
}

/* ── SYSTEM · /settings ───────────────────────────────────────────────── */
export function SystemTile({ n }: { n?: number }) {
  const [v, setV] = useState<{ healthyKeys?: number; keys?: unknown[]; backup?: { at?: string } | null; backupConfigured?: boolean } | null>(null);
  useLive(
    () => fetch("/api/vitals").then((r) => r.json()).then((j) => setV(j?.data ?? null)).catch(() => {}),
    { everyMs: 600_000 },
  );
  const keys = v?.keys?.length ?? 0;
  return (
    <Pane n={n} title="System" status={<Go href="/settings">{v ? "NOMINAL" : "…"}</Go>} live={!!v}>
      {!v && <div className="tile-wait">ACQUIRING…</div>}
      {v && (
        <>
          <Row k="Model keys healthy" v={`${v.healthyKeys ?? 0} / ${keys}`} tone={(v.healthyKeys ?? 0) < keys ? "down" : "up"} />
          <Row
            k="Last backup"
            v={v.backup?.at ? hhmm(v.backup.at) : v.backupConfigured ? "PENDING" : "NOT SET UP"}
            tone={v.backup?.at ? undefined : "signal"}
          />
        </>
      )}
    </Pane>
  );
}

export { BarRows, Progress };
