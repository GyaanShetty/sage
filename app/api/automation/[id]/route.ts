import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { runAutomation, type AutomationRow } from "@/core/automation/run";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "Invalid" }, { status: 400 });
  }
  const { error } = await db
    .from("Automation")
    .update({ enabled: body.enabled })
    .eq("id", id)
    .eq("userId", DEFAULT_USER_ID);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await db.from("Automation").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Run now. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await db
    .from("Automation")
    .select("id, name, trigger, workflow, enabled, lastRunAt")
    .eq("id", id)
    .eq("userId", DEFAULT_USER_ID)
    .maybeSingle();
  if (!data) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  try {
    const report = await runAutomation(data as AutomationRow);
    return NextResponse.json({ ok: true, data: { report } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Run failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
