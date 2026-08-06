import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { trashRow } from "@/core/ops/trash";

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
  await trashRow("Event", id);
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

/**
 * Actually check the alerts.
 *
 * These were storable, editable, deletable — and never once evaluated. Every
 * alert he had set was a rule nobody read, which is worse than no alerts at
 * all: he believed he would be told. There was nowhere sensible to run this
 * from on two crons a day; the heartbeat gives it a home.
 */
export async function evaluateAlerts(): Promise<{ checked: number; fired: string[] }> {
  const alerts = (await listAlerts()).filter((a) => a.enabled);
  if (alerts.length === 0) return { checked: 0, fired: [] };

  const { getMarkets, getStocks } = await import("@/infrastructure/markets");
  const [coins, stocks] = await Promise.all([
    getMarkets(["bitcoin", "ethereum", "solana", "chainlink"]).catch(() => null),
    getStocks().catch(() => null),
  ]);

  const quote = new Map<string, { price: number; changePct: number }>();
  for (const c of coins ?? []) quote.set(c.symbol.toUpperCase(), { price: c.price, changePct: c.change24h });
  for (const s of stocks ?? []) quote.set(s.symbol.toUpperCase(), { price: s.price, changePct: s.change });

  const fired: string[] = [];
  for (const a of alerts) {
    const q = quote.get(a.symbol.toUpperCase());
    if (!q) continue;
    if (!alertTriggered(a, q.price, q.changePct)) continue;

    // Once per day per alert. A price sitting above a threshold satisfies the
    // condition on every beat, and an alert that fires forty times is noise he
    // will turn off — which loses the alert entirely.
    const firedToday =
      a.lastFiredAt &&
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(a.lastFiredAt)) ===
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    if (firedToday) continue;

    await updateAlert(a.id, { lastFiredAt: new Date().toISOString() });

    const { sendPush } = await import("@/infrastructure/push");
    await sendPush({
      title: `📈 ${a.symbol}`,
      body: `${describeAlert(a)} — now ${q.price.toLocaleString()} (${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}%)${a.note ? ` · ${a.note}` : ""}`,
      tag: `alert-${a.id}`,
      url: "/portfolio",
    }).catch(() => 0);

    fired.push(describeAlert(a));
  }

  return { checked: alerts.length, fired };
}
