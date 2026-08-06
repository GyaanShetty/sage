import { NextResponse } from "next/server";
import { listTrash, restoreTrash, purgeTrash } from "@/core/ops/trash";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, data: { items: await listTrash().catch(() => []) } });
}

/** Restore one item, or empty what has aged out. */
export async function POST(req: Request) {
  const { id, purge } = (await req.json().catch(() => ({}))) as { id?: string; purge?: boolean | number };

  if (purge !== undefined) {
    // `true` empties everything; a number keeps that many days.
    const days = typeof purge === "number" ? purge : 0;
    return NextResponse.json({ ok: true, data: { purged: await purgeTrash(days) } });
  }

  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const result = await restoreTrash(id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, data: { restored: result.label, items: await listTrash() } });
}
