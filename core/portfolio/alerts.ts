import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export type AlertCondition = "above" | "below" | "pct_up" | "pct_down";

export interface PriceAlert {
  id: string;
  symbol: string;
  kind: "crypto" | "stock";
  condition: AlertCondition;
  /** Price level for above/below; percentage move for pct_up/pct_down. */
  value: number;
  enabled: boolean;
  note?: string | null;
  lastFiredAt?: string | null;
}

const A_TYPE = "portfolio.alert";

export async function listAlerts(): Promise<PriceAlert[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", A_TYPE)
    .order("createdAt", { ascending: false }).limit(100);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<PriceAlert, "id">) }));
}

export async function addAlert(a: Partial<PriceAlert>): Promise<string> {
  const id = crypto.randomUUID();
  const payload = {
    symbol: (a.symbol ?? "").toUpperCase(),
    kind: a.kind === "stock" ? "stock" : "crypto",
    condition: (["above", "below", "pct_up", "pct_down"] as const).includes(a.condition as never) ? a.condition : "above",
    value: Number(a.value) || 0,
    enabled: a.enabled !== false,
    note: a.note ?? null,
    lastFiredAt: null,
  };
  await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: A_TYPE, payload });
  return id;
}

export async function updateAlert(id: string, patch: Partial<PriceAlert>): Promise<void> {
  const { data } = await db.from("Event").select("payload").eq("id", id).maybeSingle();
  if (!data) return;
  const merged = { ...(data.payload as object), ...patch };
  delete (merged as { id?: string }).id;
  await db.from("Event").update({ payload: merged }).eq("id", id);
}

export async function deleteAlert(id: string): Promise<void> {
  await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
}

/** Does this live quote satisfy the alert's condition? */
export function alertTriggered(a: PriceAlert, price: number | null, changePct: number | null): boolean {
  if (!a.enabled) return false;
  if (a.condition === "above") return price != null && price >= a.value;
  if (a.condition === "below") return price != null && price <= a.value;
  if (a.condition === "pct_up") return changePct != null && changePct >= a.value;
  if (a.condition === "pct_down") return changePct != null && changePct <= -Math.abs(a.value);
  return false;
}

/** Human-readable rendering of an alert rule, for the UI and push body. */
export function describeAlert(a: PriceAlert): string {
  if (a.condition === "above") return `${a.symbol} rises above ${a.value}`;
  if (a.condition === "below") return `${a.symbol} falls below ${a.value}`;
  if (a.condition === "pct_up") return `${a.symbol} gains ${a.value}% in a day`;
  return `${a.symbol} drops ${Math.abs(a.value)}% in a day`;
}
