import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * What the agent has been doing.
 *
 * Runs have been written to `AgentRun` since the agent shipped and there has
 * never been a way to read them back — so the history existed, cost storage,
 * and could not be shown. This is that route.
 *
 * Output is deliberately not returned in the list. A research report is
 * kilobytes of prose and this feeds a log panel that shows a line per run;
 * sending every report to render twelve timestamps would make the densest
 * panel on the dashboard the most expensive thing on the page. `?id=` returns
 * one run in full.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get("id");

  if (id) {
    const { data, error } = await db
      .from("AgentRun")
      .select("id, kind, input, status, output, createdAt")
      .eq("userId", DEFAULT_USER_ID)
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, data });
  }

  const limit = Math.min(Math.max(Number(q.get("limit") ?? 20), 1), 100);
  const { data, error } = await db
    .from("AgentRun")
    .select("id, kind, input, status, createdAt")
    .eq("userId", DEFAULT_USER_ID)
    .order("createdAt", { ascending: false })
    .limit(limit);

  // Supabase returns errors rather than throwing them, so an unchecked call
  // here would quietly render an empty log as though nothing had ever run.
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: data ?? [] });
}
