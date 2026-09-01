"use client";

import { useState } from "react";
import Link from "next/link";
import { Pane, Row, Empty } from "@/components/pane";
import { BarStrip, BarRows, Ring, Matrix, Progress, Delta } from "@/components/instruments";
import { useLive } from "@/lib/live";
import { TZ } from "@/lib/config";
import { asArray } from "@/lib/as-array";

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
interface SitLine { key: string; label: string; value: string; detail?: string; level: string; tier?: string }

const TIERS: { key: string; label: string }[] = [
  { key: "now", label: "NOW" },
  { key: "today", label: "TODAY" },
  { key: "drift", label: "DRIFT" },
  { key: "system", label: "SYSTEM" },
];

export function SignalsTile({ n }: { n?: number }) {
  const [lines, setLines] = useState<SitLine[] | null>(null);

  /**
   * Reads /api/sitrep/live, which is the structured build over seven
   * producers. The band used to read /api/sitrep — a flat, older list — so the
   * dashboard and the sitrep page were two different answers to the same
   * question, and only one of them had tiers.
   */
  useLive(
    () => fetch("/api/sitrep/live").then((r) => r.json())
      .then((j) => setLines(asArray<SitLine>(j?.data?.sitrep?.lines))).catch(() => setLines([])),
    { everyMs: 45_000, scopes: ["tasks", "events"] },
  );

  const alerting = (lines ?? []).filter((l) => l.level === "alert").length;

  return (
    <Pane
      n={n}
      title="Signals"
      status={<Go href="/sitrep">{lines ? (alerting ? `${pad(alerting)} ALERT` : "NOMINAL") : "…"}</Go>}
      live={!!lines?.length}
    >
      {!lines && <div className="tile-wait">ACQUIRING…</div>}
      {lines?.length === 0 && <Empty reason="Nothing needs you" action="Open sitrep" href="/sitrep" />}
      {TIERS.map(({ key, label }) => {
        // An alert is promoted to NOW whatever produced it, so a tier can be
        // empty on a quiet day. An empty heading is noise; skip it.
        const rows = (lines ?? []).filter((l) => (l.tier ?? "today") === key);
        if (!rows.length) return null;
        return (
          <div key={key}>
            <div className="sig-tier">{label}</div>
            {rows.map((l) => (
              <div className={`sig-row ${l.level}`} key={l.key}>
                <span className="sg-k">{l.label}</span>
                <span className="sg-v">{l.value}</span>
              </div>
            ))}
          </div>
        );
      })}
    </Pane>
  );
}

/* ── AGENT LOG · /agents ──────────────────────────────────────────────── */
export function AgentLogTile({ n }: { n?: number }) {
  const [runs, setRuns] = useState<{ id: string; kind: string; input: string; status: string; createdAt: string }[] | null>(null);
  useLive(
    () => fetch("/api/agent/runs?limit=12").then((r) => r.json()).then((j) => setRuns(asArray(j?.data))).catch(() => setRuns([])),
    { everyMs: 120_000, scopes: ["agent"] },
  );
  return (
    <Pane n={n} title="Agent Log" status={<Go href="/agents">{runs ? `${pad(runs.length)} RUNS` : "…"}</Go>} live={!!runs?.length}>
      {!runs && <div className="tile-wait">ACQUIRING…</div>}
      {runs?.length === 0 && <Empty reason="No agent has run" action="Start one" href="/agents" />}
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
      .then((j) => setDays(asArray(j?.data?.days, j?.data))).catch(() => setDays([])),
    { everyMs: 900_000 },
  );
  const recent = (days ?? []).slice(-182);
  const total = recent.reduce((s, d) => s + (d.count ?? 0), 0);
  return (
    <Pane n={n} title="Commits" status={<Go href="/push">{days ? `${total} · 26W` : "…"}</Go>}>
      {!days && <div className="tile-wait">ACQUIRING…</div>}
      {days?.length === 0 && <Empty reason="GitHub not reporting" action="Check the token" href="/settings" />}
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
      {!v && <Empty reason="Nothing synced today" action="Run the Health shortcut" href="/health" />}
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
          {asArray<number>(v.load).length ? <BarStrip data={asArray<number>(v.load)} height={26} /> : null}
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
      {p && p.total == null && <Empty reason="No holdings" action="Add one" href="/portfolio" />}
      {p?.total != null && (
        <>
          <div className="tstat">
            <span className="tstat-v">₹{Math.round(p.total).toLocaleString("en-IN")}</span>
            <span className="tstat-k">TOTAL VALUE</span>
          </div>
          {typeof p.changePct === "number" && (
            <Row k="Today" v={<Delta pct={p.changePct} />} />
          )}
          {asArray<number>(p.curve).length ? <BarStrip data={asArray<number>(p.curve)} height={30} /> : null}
          {asArray<{ symbol: string; value: number }>(p.holdings).slice(0, 5).map((h) => (
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
      .then((j) => setM({ total: j?.data?.total, recent: asArray(j?.data?.items, j?.data) })).catch(() => {}),
    { everyMs: 300_000, scopes: ["memory"] },
  );
  return (
    <Pane n={n} title="Memory" status={<Go href="/memory">{m?.total != null ? `${m.total} HELD` : "…"}</Go>}>
      {!m && <div className="tile-wait">ACQUIRING…</div>}
      {m?.recent?.length === 0 && <Empty reason="Nothing remembered yet" action="Tell Sage something" href="/memory" />}
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
    () => fetch("/api/exam").then((r) => r.json()).then((j) => setEx(asArray(j?.data?.exams, j?.data))).catch(() => setEx([])),
    { everyMs: 3_600_000 },
  );
  const daysTo = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return (
    <Pane n={n} title="Exams" status={<Go href="/exam">{ex ? `${pad(ex.length)}` : "…"}</Go>}>
      {!ex && <div className="tile-wait">ACQUIRING…</div>}
      {ex?.length === 0 && <Empty reason="No papers scheduled" action="Add an exam" href="/exam" />}
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
