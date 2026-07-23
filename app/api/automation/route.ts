import { NextResponse } from "next/server";
import { z } from "zod";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  directive: z.string().min(5).max(2000),
  // legacy: daily time. new: full trigger object.
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  trigger: z
    .object({
      type: z.enum(["daily", "condition"]),
      time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      when: z.enum(["task_overdue", "aqi_above", "crypto_move", "low_steps", "unread_email"]).optional(),
      threshold: z.number().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid automation" }, { status: 400 });
  }
  await ensureDefaultUser();
  const trigger = parsed.data.trigger ?? { type: "daily" as const, time: parsed.data.time ?? "08:00" };
  const automation = {
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    name: parsed.data.name,
    trigger,
    workflow: { directive: parsed.data.directive },
    enabled: true,
  };
  const { error } = await db.from("Automation").insert(automation);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: automation });
}
