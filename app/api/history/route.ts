import { NextResponse } from "next/server";
import { seriesFor, byWeekday, values } from "@/core/history";

/**
 * A pane's own past, for the charts.
 *
 * One endpoint rather than one per pane: every series is the same query —
 * count or sum an Event type over N days — and thirty near-identical routes
 * would drift apart within a week.
 *
 * `type` is not free-form. A pane asking for an arbitrary Event type would let
 * the client read any row in the table by name, and the allowlist is also the
 * list of things worth charting.
 */
export const dynamic = "force-dynamic";

const SERIES: Record<string, { type: string; field?: string; label: string }> = {
  spend:     { type: "expense.logged", field: "amount", label: "Spend" },
  tasks:     { type: "task.done", label: "Tasks completed" },
  agents:    { type: "agent.run", label: "Agent runs" },
  memories:  { type: "memory.saved", label: "Memories" },
  notes:     { type: "note.created", label: "Notes" },
  reviews:   { type: "review.answered", label: "Cards reviewed" },
  journal:   { type: "journal.entry", label: "Journal entries" },
  reading:   { type: "link.saved", label: "Saved to read" },
  focus:     { type: "focus.session", field: "minutes", label: "Focus minutes" },
  health:    { type: "health.report", field: "steps", label: "Steps" },
};

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const key = q.get("series") ?? "";
  const spec = SERIES[key];
  if (!spec) {
    return NextResponse.json(
      { ok: false, error: `Unknown series. One of: ${Object.keys(SERIES).join(", ")}` },
      { status: 400 },
    );
  }

  const days = Math.min(365, Math.max(7, Number(q.get("days") ?? 30) || 30));

  try {
    const points = await seriesFor(spec.type, days, spec.field);
    return NextResponse.json({
      ok: true,
      data: {
        label: spec.label,
        days,
        points,
        values: values(points),
        weekday: byWeekday(points),
        total: points.reduce((t, p) => t + p.value, 0),
        // Whether anything was *ever* recorded, which is the difference
        // between a quiet week and a pane that has never worked. The charts
        // need to tell those apart.
        any: points.some((p) => p.value > 0),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not read history." }, { status: 500 });
  }
}
