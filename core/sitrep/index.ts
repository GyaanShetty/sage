import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { tzDay } from "@/lib/config";
// Never let one slow source hold up the readout.
import { within } from "@/lib/budget";

/**
 * The situation, right now.
 *
 * Everything in SAGE is already true somewhere — the agenda knows the next
 * commitment, the budget knows the pace, the health page knows the steps. What
 * has never existed is one reading of all of it at once, so the answer to
 * "where do things stand" meant opening six pages and doing the joining
 * yourself.
 *
 * Deliberately no model anywhere in this file. A sitrep has to be instant and
 * has to be the same numbers every time — a summariser would add a second of
 * latency, a quota cost and a chance of drift, in exchange for prose nobody
 * asked for. Reading is the UI's job; this just tells the truth quickly.
 *
 * Cheap enough to poll: every field is one indexed query, they all run in
 * parallel, and any one of them failing degrades to null rather than taking
 * the readout down. A sitrep that disappears because the weather API is slow
 * is not a sitrep.
 */

export type Level = "ok" | "watch" | "alert";

/**
 * Four layers, because "everything that might matter" in one flat list is not
 * a status board — it is a pile you have to read in full to learn anything.
 *
 *  NOW    · happening or imminent; act on it in the next hour.
 *  TODAY  · the shape of the day: what is booked, owed, and budgeted.
 *  DRIFT  · departures from his own baselines. Nothing here is an emergency,
 *           and that is the point — drift is what you only see over time.
 *  SYSTEM · SAGE's own health. Separate because a broken feed is not a fact
 *           about his life, and mixing the two makes both harder to trust.
 */
export type Tier = "now" | "today" | "drift" | "system";

/** Which layer each producer belongs to. */
const TIER_OF: Record<string, Tier> = {
  agenda: "now",
  tasks: "today",
  budget: "today",
  markets: "today",
  mail: "today",
  health: "drift",
  system: "system",
};

export function tierOf(key: string): Tier {
  return TIER_OF[key] ?? "today";
}

export interface SitrepLine {
  key: string;
  label: string;
  value: string;
  detail?: string;
  level: Level;
  href?: string;
  tier?: Tier;
}

export interface Sitrep {
  at: string;
  /** Countdown target for the next commitment, so the client can tick it. */
  nextEventAt: string | null;
  nextEventTitle: string | null;
  lines: SitrepLine[];
  /** Anything actively wrong, hoisted so the UI can lead with it. */
  alerts: SitrepLine[];
}

const BUDGET_MS = 2500;

export async function buildSitrep(): Promise<Sitrep> {
  const now = new Date();

  const [agenda, tasks, health, budget, markets, mail, system] = await Promise.all([
    within(agendaLine(), BUDGET_MS, null),
    within(taskLine(), BUDGET_MS, null),
    within(healthLine(), BUDGET_MS, null),
    within(budgetLine(), BUDGET_MS, null),
    within(marketLine(), BUDGET_MS, null),
    within(mailLine(), BUDGET_MS, null),
    within(systemLine(), BUDGET_MS, null),
  ]);

  const lines = [agenda?.line, tasks, health, budget, markets, mail, system]
    .filter((l): l is SitrepLine => !!l)
    .map((l) => ({ ...l, tier: l.tier ?? tierOf(l.key) }));

  return {
    at: now.toISOString(),
    nextEventAt: agenda?.at ?? null,
    nextEventTitle: agenda?.title ?? null,
    lines,
    // Anything actively wrong is NOW whatever produced it — a breached budget
    // stops being a fact about the month and becomes a thing to deal with.
    alerts: lines.filter((l) => l.level === "alert").map((l) => ({ ...l, tier: "now" as Tier })),
  };
}

async function agendaLine(): Promise<{ line: SitrepLine; at: string | null; title: string | null } | null> {
  const { upcomingEvents } = await import("@/core/calendar");
  const events = await upcomingEvents(5, 2);
  const next = events.find((e) => !e.allDay && e.start);

  if (!next) {
    return {
      line: { key: "agenda", label: "Agenda", value: "Clear", level: "ok", href: "/dashboard" },
      at: null, title: null,
    };
  }

  const mins = Math.round((new Date(next.start).getTime() - Date.now()) / 60_000);
  return {
    line: {
      key: "agenda",
      label: "Next",
      value: next.summary,
      detail: next.location ?? undefined,
      // Inside the hour is worth noticing; inside twenty minutes you should
      // already be moving.
      level: mins <= 20 ? "alert" : mins <= 60 ? "watch" : "ok",
      href: "/dashboard",
    },
    at: next.start,
    title: next.summary,
  };
}

async function taskLine(): Promise<SitrepLine | null> {
  const nowIso = new Date().toISOString();
  const [{ data: overdue }, { data: open }] = await Promise.all([
    db.from("Task").select("id").eq("userId", DEFAULT_USER_ID)
      .neq("status", "done").neq("status", "cancelled").lt("dueAt", nowIso).limit(50),
    db.from("Task").select("id").eq("userId", DEFAULT_USER_ID)
      .neq("status", "done").neq("status", "cancelled").limit(200),
  ]);

  const late = overdue?.length ?? 0;
  const total = open?.length ?? 0;
  return {
    key: "tasks",
    label: "Tasks",
    value: total === 0 ? "Nothing open" : `${total} open`,
    detail: late > 0 ? `${late} overdue` : undefined,
    level: late > 3 ? "alert" : late > 0 ? "watch" : "ok",
    href: "/workspace",
  };
}

async function healthLine(): Promise<SitrepLine | null> {
  const { listDays, getGoals } = await import("@/core/health/store");
  const [days, goals] = await Promise.all([listDays(2), getGoals()]);
  const today = days.find((d) => d.day === tzDay());

  if (!today || today.steps == null) {
    return { key: "health", label: "Steps", value: "Nothing logged today", level: "watch", href: "/health" };
  }

  const pct = Math.round((today.steps / goals.steps) * 100);
  return {
    key: "health",
    label: "Steps",
    value: `${today.steps.toLocaleString()}`,
    detail: `${pct}% of ${goals.steps.toLocaleString()}`,
    level: pct >= 100 ? "ok" : pct >= 50 ? "watch" : "alert",
    href: "/health",
  };
}

async function budgetLine(): Promise<SitrepLine | null> {
  const { getPlan, budgetStatus, currentMonth } = await import("@/core/finance/budget");
  const plan = await getPlan(currentMonth());
  if (!plan) return null;

  const { listExpenses } = await import("@/core/finance/expenses");
  const status = budgetStatus(plan, await listExpenses(60));
  const over = status.lines.filter((l) => l.state === "over").length;
  const watch = status.lines.filter((l) => l.state === "watch").length;

  return {
    key: "budget",
    label: "Budget",
    value: `₹${status.totalSpent.toLocaleString("en-IN")} of ₹${status.totalBudget.toLocaleString("en-IN")}`,
    detail: over ? `${over} over` : watch ? `${watch} on pace to overshoot` : "on track",
    level: over ? "alert" : watch ? "watch" : "ok",
    href: "/portfolio",
  };
}

async function marketLine(): Promise<SitrepLine | null> {
  const { inMarketHours } = await import("@/core/ops/heartbeat");
  const { getMarkets } = await import("@/infrastructure/markets");
  const coins = await getMarkets(["bitcoin", "ethereum"]);
  if (!coins?.length) return null;

  const btc = coins[0];
  return {
    key: "markets",
    label: btc.symbol,
    value: `$${Math.round(btc.price).toLocaleString()}`,
    detail: `${btc.change24h >= 0 ? "+" : ""}${btc.change24h.toFixed(1)}% · NSE ${inMarketHours() ? "open" : "closed"}`,
    level: Math.abs(btc.change24h) >= 5 ? "watch" : "ok",
    href: "/markets",
  };
}

async function mailLine(): Promise<SitrepLine | null> {
  const { listGmail } = await import("@/infrastructure/integrations/google");
  const unread = await listGmail("is:unread in:inbox", 20);
  if (unread === null) return null;

  const important = unread.filter((m) => m.important).length;
  return {
    key: "mail",
    label: "Inbox",
    value: unread.length === 0 ? "Clear" : `${unread.length} unread`,
    detail: important > 0 ? `${important} flagged important` : undefined,
    level: important > 0 ? "watch" : "ok",
    href: "/mail",
  };
}

/**
 * SAGE's own state.
 *
 * A status board that cannot report its own failure is decoration. This is the
 * line that says the AI is out of quota, or the heartbeat has stopped — the
 * two failures that make everything else on the page quietly stale.
 */
async function systemLine(): Promise<SitrepLine | null> {
  const { modelKeyStatus } = await import("@/infrastructure/llm");
  const keys = modelKeyStatus();
  const healthy = keys.filter((k) => k.healthy).length;

  const { data: beat } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", "ops.lastrun")
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();

  // The reminders job runs every minute when the heartbeat is alive, so its
  // last-run time is the most sensitive pulse available.
  const last = (beat?.payload as Record<string, string> | null)?.reminders;
  const silentMin = last ? Math.round((Date.now() - new Date(last).getTime()) / 60_000) : null;

  const beatDead = silentMin !== null && silentMin > 30;
  const noKeys = keys.length > 0 && healthy === 0;

  return {
    key: "system",
    label: "SAGE",
    value: noKeys ? "Out of quota" : beatDead ? "Heartbeat silent" : "Nominal",
    detail: noKeys
      ? `all ${keys.length} keys cooling`
      : silentMin === null
        ? "heartbeat not configured"
        : `beat ${silentMin}m ago`,
    level: noKeys || beatDead ? "alert" : "ok",
    href: "/settings",
  };
}
