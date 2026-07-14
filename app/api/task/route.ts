import { NextResponse } from "next/server";
import { z } from "zod";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  dueAt: z.string().datetime().optional(),
  priority: z.number().int().min(0).max(3).optional(),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid task" }, { status: 400 });
  }
  await ensureDefaultUser();
  const task = {
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    title: parsed.data.title,
    priority: parsed.data.priority ?? 2,
    ...(parsed.data.dueAt ? { dueAt: parsed.data.dueAt } : {}),
  };
  const { error } = await db.from("Task").insert(task);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: task });
}
