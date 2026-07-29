import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";

export interface Snapshot {
  day: string;   // YYYY-MM-DD
  value: number;
  cost: number;
  pnl: number;
}

const S_TYPE = "portfolio.snapshot";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/**
 * Record today's portfolio value once per day. Idempotent: re-running updates
 * the same day's row rather than appending, so the equity curve stays clean.
 */
export async function snapshotToday(totals: { value: number; cost: number; pnl: number }): Promise<boolean> {
  if (!Number.isFinite(totals.value) || totals.value <= 0) return false;
  const day = today();
  const { data: existing } = await db
    .from("Event").select("id")
    .eq("userId", DEFAULT_USER_ID).eq("type", S_TYPE)
    .contains("payload", { day }).limit(1).maybeSingle();

  const payload = { day, value: totals.value, cost: totals.cost, pnl: totals.pnl };
  if (existing?.id) {
    await db.from("Event").update({ payload }).eq("id", existing.id);
    return false;
  }
  await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: S_TYPE, payload });
  return true;
}

/** The equity curve, oldest first. */
export async function listSnapshots(days = 180): Promise<Snapshot[]> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", S_TYPE)
    .order("createdAt", { ascending: true }).limit(400);
  const rows = (data ?? []).map((r) => r.payload as Snapshot).filter((s) => s?.day);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cut = cutoff.toISOString().slice(0, 10);
  return rows.filter((s) => s.day >= cut).sort((a, b) => a.day.localeCompare(b.day));
}
