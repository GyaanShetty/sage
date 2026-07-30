import { NextResponse } from "next/server";
import { z } from "zod";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { runAutomation, type AutomationRow } from "@/core/automation/run";

/** Every field is optional: this endpoint both flips the switch and saves an
 *  edit, and callers only ever send what changed. */
const patchSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).max(80).optional(),
  directive: z.string().min(5).max(2000).optional(),
  trigger: z
    .object({
      type: z.enum(["daily", "condition"]),
      time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      when: z.enum(["task_overdue", "aqi_above", "crypto_move", "low_steps", "unread_email"]).optional(),
      threshold: z.number().optional(),
    })
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.trigger !== undefined) patch.trigger = parsed.data.trigger;
  // workflow is a JSON column; directive is the only field in it today, but
  // write it as an object so adding steps later does not need a migration.
  if (parsed.data.directive !== undefined) patch.workflow = { directive: parsed.data.directive };
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await db
    .from("Automation")
    .update(patch)
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
