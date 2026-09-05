"use client";

import { useState } from "react";
import { Pane, Empty } from "@/components/pane";
import { Area, Radial, Heat, Gauge, Histogram, Stack, BarStrip } from "@/components/instruments";
import { useLive } from "@/lib/live";

/**
 * Panes that draw their own history.
 *
 * The wall reads as empty because a pane holding one number that happens to be
 * zero today looks exactly like a pane that has never worked. A series
 * separates them, and it fills the space a single figure leaves behind — which
 * is most of the pane once the panes are large enough to be worth looking at.
 *
 * They all share the same shape, which is the point of the endpoint being one
 * endpoint: fetch a named series, and either draw it or say honestly that
 * nothing has ever been recorded. A chart through one point is a worse lie
 * than an empty state, so `any` decides which.
 */

interface Series {
  label: string;
  days: number;
  values: number[];
  weekday: number[];
  total: number;
  any: boolean;
}

function useSeries(name: string, days = 30) {
  const [s, setS] = useState<Series | null>(null);
  const [failed, setFailed] = useState(false);
  useLive(
    () =>
      fetch(`/api/history?series=${name}&days=${days}`)
        .then((r) => r.json())
        .then((j) => (j?.ok ? setS(j.data as Series) : setFailed(true)))
        .catch(() => setFailed(true)),
    { everyMs: 900_000 },
  );
  return { s, failed };
}

/** The shared frame: loading, never-recorded, or the chart. */
function ChartPane({
  n, title, series, days, status, children, reason, action, href,
}: {
  n?: number;
  title: string;
  series: string;
  days?: number;
  status?: React.ReactNode;
  reason: string;
  action?: string;
  href?: string;
  children: (s: Series) => React.ReactNode;
}) {
  const { s, failed } = useSeries(series, days);
  return (
    <Pane n={n} title={title} status={status ?? (s ? `${days ?? 30}D` : "…")} live={!!s?.any}>
      {!s && !failed && <div className="tile-wait">ACQUIRING…</div>}
      {(failed || (s && !s.any)) && <Empty reason={reason} action={action} href={href} />}
      {s?.any && <div className="chartfill">{children(s)}</div>}
    </Pane>
  );
}

/* ── the panes ─────────────────────────────────────────────────────────── */

export function SpendTrendTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Spend · 30 days" series="spend" reason="Nothing logged yet"
      action="Log an expense" href="/settings">
      {(s) => <Area data={s.values} tone="var(--signal)" />}
    </ChartPane>
  );
}

export function SpendShapeTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Spend by weekday" series="spend" days={90}
      reason="Not enough spending recorded" action="Log an expense" href="/settings">
      {(s) => <Radial data={s.weekday} labels={["M", "T", "W", "T", "F", "S", "S"]} />}
    </ChartPane>
  );
}

export function TaskRhythmTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Done · 12 weeks" series="tasks" days={84}
      reason="No completed directives yet" action="Open tasks" href="/dashboard">
      {(s) => <Heat days={s.values} weeks={12} />}
    </ChartPane>
  );
}

export function TaskWeekdayTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="When work lands" series="tasks" days={90}
      reason="No completed directives yet" action="Open tasks" href="/dashboard">
      {(s) => <Radial data={s.weekday} labels={["M", "T", "W", "T", "F", "S", "S"]} tone="var(--up)" />}
    </ChartPane>
  );
}

export function FocusTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Focus · this week" series="focus" days={7}
      reason="No focus sessions recorded" action="Start a cycle" href="/dashboard">
      {(s) => {
        const week = s.values.reduce((t, v) => t + v, 0);
        // 25 minutes a day, five days — a target he can actually hit rather
        // than an aspirational number the gauge is always red against.
        return <Gauge value={week} max={125} label="min / wk" unit="" />;
      }}
    </ChartPane>
  );
}

export function AgentRunsTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Agent runs · 30 days" series="agents"
      reason="No agent has ever run" action="Start one" href="/agents">
      {(s) => <BarStrip data={s.values} />}
    </ChartPane>
  );
}

export function MemoryGrowthTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Memory · 90 days" series="memories" days={90}
      reason="Nothing remembered yet" action="Open memory" href="/memory">
      {(s) => {
        // Cumulative, because the question is how much SAGE knows, not how
        // much it learned on a given Tuesday.
        let run = 0;
        return <Area data={s.values.map((v) => (run += v))} tone="var(--up)" />;
      }}
    </ChartPane>
  );
}

export function ReadingTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Saved to read" series="reading" days={84}
      reason="Nothing saved yet" action="Open reading" href="/read">
      {(s) => <Heat days={s.values} weeks={12} tone="var(--warn)" />}
    </ChartPane>
  );
}

export function ReviewTrendTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Cards reviewed" series="reviews" days={60}
      reason="No cards reviewed yet" action="Open review" href="/review">
      {(s) => <Histogram values={s.values.filter((v) => v > 0)} />}
    </ChartPane>
  );
}

export function JournalTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Journal · 12 weeks" series="journal" days={84}
      reason="Nothing written yet" action="Open journal" href="/workspace">
      {(s) => <Heat days={s.values} weeks={12} tone="var(--up)" />}
    </ChartPane>
  );
}

export function StepsTile({ n }: { n?: number }) {
  return (
    <ChartPane n={n} title="Steps · 30 days" series="health"
      reason="Health has never reported" action="Set up the shortcut" href="/health">
      {(s) => <Area data={s.values} tone="var(--up)" />}
    </ChartPane>
  );
}

/**
 * What SAGE has recorded of him, by kind.
 *
 * The one pane whose emptiness is the reading: if every bar is short, SAGE
 * genuinely does not know much yet, and that is worth seeing rather than
 * hiding behind a placeholder.
 */
export function CorpusTile({ n }: { n?: number }) {
  const memories = useSeries("memories", 90);
  const notes = useSeries("notes", 90);
  const journal = useSeries("journal", 90);
  const reading = useSeries("reading", 90);

  const parts = [
    { label: "Memories", value: memories.s?.total ?? 0, tone: "var(--signal)" },
    { label: "Notes", value: notes.s?.total ?? 0, tone: "var(--warn)" },
    { label: "Journal", value: journal.s?.total ?? 0, tone: "var(--up)" },
    { label: "Reading", value: reading.s?.total ?? 0, tone: "#35c7ff" },
  ];
  const loaded = memories.s && notes.s && journal.s && reading.s;
  const total = parts.reduce((t, p) => t + p.value, 0);

  return (
    <Pane n={n} title="What SAGE holds" status={loaded ? `${total} · 90D` : "…"} live={total > 0}>
      {!loaded && <div className="tile-wait">ACQUIRING…</div>}
      {loaded && total === 0 && <Empty reason="Nothing recorded in 90 days" action="Open memory" href="/memory" />}
      {loaded && total > 0 && <Stack parts={parts} height={14} />}
    </Pane>
  );
}
