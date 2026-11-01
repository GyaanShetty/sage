import { NextResponse } from "next/server";
import { syncTasks } from "@/core/tasks/sync";

/**
 * Reconcile SAGE's tasks with TickTick.
 *
 * POST because it writes to both systems. Runs from the heartbeat and
 * from the button on the board, and is safe to call twice in a row: a
 * second pass over an already-reconciled pair finds nothing differing
 * from the remembered snapshot and does nothing.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const report = await syncTasks();
  /* 200 even when TickTick is not connected: "not connected" is a state
     to display, not a server error to retry. */
  return NextResponse.json({ ok: report.ok, data: report });
}
