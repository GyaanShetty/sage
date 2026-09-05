import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listUnreadEmails } from "@/infrastructure/integrations/google";
import { upcomingEvents } from "@/core/calendar";
import { getMarkets } from "@/infrastructure/markets";
import { getWeather } from "@/infrastructure/weather";
import { trainingSummary } from "@/core/health/hevy";
import { getPositions } from "@/core/portfolio/store";
import { TZ } from "@/lib/config";
import { listOutlookMail } from "@/infrastructure/integrations/outlook";
import { type RankedMail, gatherMail, rankMail } from "@/core/mail/triage";
import { findOpportunities } from "@/core/career/inbox";

/**
 * The shape of the day, assembled once.
 *
 * The briefs used to be handed raw lists — eight task rows, five calendar
 * entries — and asked to say something useful about them. That produces a
 * read-out, not a briefing: "you have eight tasks" is a fact you could get
 * from the number on the screen. What makes it a briefing is the judgement
 * on top: that the day is back-to-back until two, that three of those tasks
 * are already overdue, that the only real gap is the afternoon.
 *
 * So the derivation happens here, in code, deterministically. The model gets
 * conclusions to narrate rather than data to interpret — which is both more
 * reliable and much harder to get subtly wrong.
 */

export interface AgendaEvent {
  summary: string;
  startsAt: string | null;
  /** Minutes from now; negative if already running. */
  inMin: number | null;
  allDay: boolean;
  location?: string;
  durationMin: number | null;
}

export interface AgendaTask {
  id: string;
  title: string;
  dueAt: string | null;
  priority: number;
  state: "overdue" | "today" | "soon" | "later";
  overdueDays?: number;
}

export interface DayPicture {
  now: string;
  weekday: string;
  date: string;
  weekend: boolean;

  /** Calendar */
  events: AgendaEvent[];
  next: AgendaEvent | null;
  committedMin: number;
  /** "clear" | "light" | "busy" | "packed" — how the day reads at a glance. */
  load: "clear" | "light" | "busy" | "packed";
  /** Largest uninterrupted stretch left today, in minutes. */
  longestGapMin: number | null;
  lastEventEndsAt: string | null;

  /** Tasks */
  tasks: AgendaTask[];
  overdue: AgendaTask[];
  dueToday: AgendaTask[];
  headline: AgendaTask | null;
  openCount: number;

  /** The rest of his world */
  unread: { from: string; subject: string; account: "gmail" | "outlook" }[];
  /**
   * The few messages that actually need him, with a reason each.
   *
   * Separate from `unread`, which is a count and a sample. This is the answer
   * to "is there anything in my mail" — which is what he asks, and what a
   * count has never told him.
   */
  importantMail: RankedMail[];
  /** Internship mail, forms and interviews found in Outlook, soonest deadline
   *  first. Empty when Outlook is not connected. */
  opportunities: { subject: string; from: string; deadline: string | null; kinds: string[] }[];
  markets: { symbol: string; change24h: number | null }[];
  portfolio: { value: number; pnl: number; movers: { symbol: string; change24h: number | null }[] } | null;
  weather: { label: string; temp: number; high: number; low: number; place: string; aqi?: number | null } | null;
  /** Pending reminders and standing goals — what he asked to be nagged about,
   *  and what the day is ultimately in service of. */
  reminders: { text: string; remindAt: string | null }[];
  goals: string[];
  /** This month's budget against what has actually been spent, if one is set. */
  budget: {
    spent: number; planned: number; projected: number; leftToSpend: number;
    over: string[];       // lines already breached
    watch: string[];      // lines on pace to breach
  } | null;
  training: { daysSinceLast: number | null; perWeek: number; workouts: number } | null;
}

const MIN = 60_000;

function fmtParts(tz: string) {
  const now = new Date();
  return {
    weekday: new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now),
    date: new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long" }).format(now),
    dow: new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(now),
  };
}

/** End of today in the configured timezone, as an epoch. */
function endOfToday(tz: string): number {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  // Offset is recovered by comparing the same instant formatted in the tz
  // against UTC, rather than hardcoding +05:30 — the app should not break if
  // TZ is ever changed.
  const asTz = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const asUtc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = asTz.getTime() - asUtc.getTime();
  return new Date(`${ymd}T23:59:59.999Z`).getTime() - offsetMs;
}

function classifyTask(dueAt: string | null, tz: string): { state: AgendaTask["state"]; overdueDays?: number } {
  if (!dueAt) return { state: "later" };
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return { state: "later" };
  const now = Date.now();
  if (due < now) return { state: "overdue", overdueDays: Math.max(1, Math.floor((now - due) / 86_400_000)) };
  if (due <= endOfToday(tz)) return { state: "today" };
  if (due <= now + 3 * 86_400_000) return { state: "soon" };
  return { state: "later" };
}

export async function buildDayPicture(): Promise<DayPicture> {
  const now = Date.now();
  const dayEnd = endOfToday(TZ);
  const { weekday, date, dow } = fmtParts(TZ);

  const [rawEvents, mail, opportunities, markets, weather, training, positions, { data: taskRows }, { data: reminderRows }, { data: goalRows }, budget] = await Promise.all([
    upcomingEvents(10).catch(() => null),
    // Both mailboxes, in one shape. Replaces a Gmail-only call that returned
    // six subjects with no way to tell which of them mattered.
    gatherMail(15).catch(() => [] as Awaited<ReturnType<typeof gatherMail>>),
    // Outlook is optional: not connected returns null and the brief simply
    // does not mention it, rather than failing to generate.
    listOutlookMail(40).then((m) => (m ? findOpportunities(m) : [])).catch(() => []),
    getMarkets().catch(() => null),
    getWeather().catch(() => null),
    trainingSummary(30).catch(() => null),
    listPositionsSafely(),
    db
      .from("Task")
      .select("id, title, dueAt, priority")
      .eq("userId", DEFAULT_USER_ID)
      .in("status", ["todo", "doing"])
      .order("priority")
      .limit(40),
    db
      .from("Reminder")
      .select("text, remindAt")
      .eq("userId", DEFAULT_USER_ID)
      .eq("status", "pending")
      .order("remindAt")
      .limit(5),
    db
      .from("Memory")
      .select("content")
      .eq("userId", DEFAULT_USER_ID)
      .eq("type", "goal")
      .is("supersededBy", null)
      .order("importance", { ascending: false })
      .limit(3),
    budgetPicture(),
  ]);

  /*
   * Ranked after the parallel gather rather than inside it: the ranker needs
   * the whole set to judge relative importance, and running it on an empty
   * inbox would spend a model call to be told there is nothing.
   */
  const importantMail = mail.length ? await rankMail(mail, 4).catch(() => [] as RankedMail[]) : [];

  // ── Calendar ────────────────────────────────────────────────────────────
  const events: AgendaEvent[] = (rawEvents ?? [])
    .map((e) => {
      const startRaw = e.start ?? null;
      const start = startRaw ? new Date(startRaw).getTime() : NaN;
      const end = e.end ? new Date(e.end).getTime() : NaN;
      // The API layer already resolves all-day; the date-shape check is only
      // a fallback for events that predate that flag.
      const allDay = e.allDay ?? (!!startRaw && !String(startRaw).includes("T"));
      return {
        summary: e.summary ?? "(no title)",
        startsAt: Number.isNaN(start) ? null : new Date(start).toISOString(),
        inMin: Number.isNaN(start) ? null : Math.round((start - now) / MIN),
        allDay,
        ...(e.location ? { location: e.location } : {}),
        durationMin: Number.isNaN(start) || Number.isNaN(end) ? null : Math.round((end - start) / MIN),
      } satisfies AgendaEvent;
    })
    // Only today's commitments shape today. Tomorrow's 9am is not this
    // morning's problem, and including it made the day read fuller than it was.
    .filter((e) => !e.startsAt || new Date(e.startsAt).getTime() <= dayEnd);

  const timed = events.filter((e) => !e.allDay && e.startsAt);
  const committedMin = timed.reduce((a, e) => a + (e.durationMin ?? 30), 0);
  const load: DayPicture["load"] =
    committedMin === 0 ? "clear" : committedMin < 120 ? "light" : committedMin < 300 ? "busy" : "packed";

  // Largest free stretch between now and the last commitment of the day.
  let longestGapMin: number | null = null;
  let cursor = now;
  for (const e of timed) {
    const s = new Date(e.startsAt as string).getTime();
    const gap = Math.round((s - cursor) / MIN);
    if (gap > (longestGapMin ?? 0)) longestGapMin = gap;
    cursor = Math.max(cursor, s + (e.durationMin ?? 30) * MIN);
  }
  // After the last meeting, the rest of the day is free too.
  const tailGap = Math.round((dayEnd - cursor) / MIN);
  if (tailGap > (longestGapMin ?? 0)) longestGapMin = tailGap;

  const next = timed.find((e) => (e.inMin ?? -1) >= 0) ?? null;
  const lastEventEndsAt = cursor > now ? new Date(cursor).toISOString() : null;

  // ── Tasks ───────────────────────────────────────────────────────────────
  const tasks: AgendaTask[] = (taskRows ?? []).map((t) => {
    const c = classifyTask((t.dueAt as string) ?? null, TZ);
    return {
      id: t.id as string,
      title: t.title as string,
      dueAt: (t.dueAt as string) ?? null,
      priority: (t.priority as number) ?? 3,
      state: c.state,
      ...(c.overdueDays ? { overdueDays: c.overdueDays } : {}),
    };
  });

  const overdue = tasks.filter((t) => t.state === "overdue").sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0));
  const dueToday = tasks.filter((t) => t.state === "today");

  // The one thing to say first: longest overdue, else due today by priority,
  // else the highest-priority open item. Never just "the first row".
  const headline =
    overdue[0] ??
    [...dueToday].sort((a, b) => a.priority - b.priority)[0] ??
    [...tasks].sort((a, b) => a.priority - b.priority)[0] ??
    null;

  // ── Portfolio ───────────────────────────────────────────────────────────
  let portfolio: DayPicture["portfolio"] = null;
  if (positions.length) {
    const value = positions.reduce((a, p) => a + (p.value ?? 0), 0);
    const pnl = positions.reduce((a, p) => a + (p.pnl ?? 0), 0);
    const movers = [...positions]
      .filter((p) => p.change24h != null)
      .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))
      .slice(0, 3)
      .map((p) => ({ symbol: p.symbol, change24h: p.change24h }));
    portfolio = { value, pnl, movers };
  }

  return {
    now: new Date(now).toISOString(),
    weekday, date,
    weekend: dow === "Sat" || dow === "Sun",
    events, next, committedMin, load, longestGapMin, lastEventEndsAt,
    tasks: tasks.slice(0, 12),
    overdue, dueToday, headline,
    openCount: tasks.length,
    unread: mail.map((e) => ({ from: e.fromName || e.fromAddress, subject: e.subject, account: e.account })),
    importantMail,
    opportunities: opportunities.map((o) => ({
      subject: o.subject, from: o.from, deadline: o.deadline, kinds: o.kinds,
    })),
    markets: (markets ?? []).slice(0, 6).map((c) => ({ symbol: c.symbol, change24h: c.change24h })),
    portfolio,
    weather: weather
      ? { label: weather.label, temp: weather.temp, high: weather.high, low: weather.low, place: weather.place, aqi: weather.aqi ?? null }
      : null,
    budget,
    reminders: (reminderRows ?? []).map((r) => ({ text: r.text as string, remindAt: (r.remindAt as string) ?? null })),
    goals: (goalRows ?? []).map((g) => g.content as string),
    training: training
      ? {
          daysSinceLast: training.lastAt ? Math.floor((now - new Date(training.lastAt).getTime()) / 86_400_000) : null,
          perWeek: training.perWeek,
          workouts: training.workouts,
        }
      : null,
  };
}

/**
 * This month's budget, if there is one.
 *
 * Imported lazily so the brief does not pull the finance module on every call
 * for a user who has never set a budget, and swallowed on failure: a missing
 * plan must not take the whole day picture down with it.
 */
async function budgetPicture(): Promise<DayPicture["budget"]> {
  try {
    const { getPlan, budgetStatus, currentMonth } = await import("@/core/finance/budget");
    const { listExpenses } = await import("@/core/finance/expenses");
    const plan = await getPlan(currentMonth());
    if (!plan) return null;

    const s = budgetStatus(plan, await listExpenses(60));
    return {
      spent: s.totalSpent,
      planned: s.totalBudget,
      projected: s.projectedTotal,
      leftToSpend: s.leftToSpend,
      over: s.lines.filter((l) => l.state === "over").map((l) => l.category),
      watch: s.lines.filter((l) => l.state === "watch").map((l) => l.category),
    };
  } catch {
    return null;
  }
}

/** Prices need an origin to call through; without one, skip rather than throw. */
async function listPositionsSafely() {
  try {
    const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    const { positions } = await getPositions(base, "");
    return positions;
  } catch {
    return [];
  }
}

/**
 * The day picture as prose for a prompt.
 *
 * Deliberately written as conclusions ("the day is packed", "3 tasks are
 * overdue, the worst by 6 days") rather than as a data dump, so the model is
 * narrating a judgement that has already been made correctly rather than
 * making it itself.
 */
export function describeDay(d: DayPicture): string {
  const hhmm = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
  const hrs = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

  const lines: string[] = [];
  lines.push(`Today is ${d.weekday} ${d.date}${d.weekend ? " (weekend)" : ""}, now ${hhmm(d.now)}.`);

  // Calendar
  if (d.events.length === 0) {
    lines.push("CALENDAR: nothing scheduled today — the day is his own.");
  } else {
    lines.push(
      `CALENDAR: ${d.load} — ${hrs(d.committedMin)} committed across ${d.events.length} ${d.events.length === 1 ? "entry" : "entries"}.`,
    );
    for (const e of d.events.slice(0, 6)) {
      lines.push(`  - ${e.allDay ? "all day" : hhmm(e.startsAt)} ${e.summary}${e.location ? ` (${e.location})` : ""}${e.durationMin ? ` [${hrs(e.durationMin)}]` : ""}`);
    }
    if (d.next?.inMin != null) {
      lines.push(`  Next up: "${d.next.summary}" in ${hrs(Math.max(0, d.next.inMin))}.`);
    }
    if (d.longestGapMin != null && d.longestGapMin >= 60) {
      lines.push(`  Longest free stretch left: ${hrs(d.longestGapMin)} — the only real window for deep work.`);
    }
  }

  // Tasks
  if (d.openCount === 0) {
    lines.push("TASKS: nothing open. Say so, and do not invent work.");
  } else {
    lines.push(`TASKS: ${d.openCount} open — ${d.overdue.length} overdue, ${d.dueToday.length} due today.`);
    if (d.overdue.length) {
      lines.push(
        `  Overdue: ${d.overdue.slice(0, 4).map((t) => `"${t.title}" (${t.overdueDays}d)`).join(", ")}`,
      );
    }
    if (d.dueToday.length) {
      lines.push(`  Due today: ${d.dueToday.slice(0, 5).map((t) => `"${t.title}"`).join(", ")}`);
    }
    if (d.headline) lines.push(`  Lead with this one: "${d.headline.title}".`);
  }

  /* Deadlines lead the email section. An application that closes today is the
     single most time-critical thing a morning brief can carry, and burying it
     under an unread count defeats the purpose of reading one. */
  if (d.opportunities.length) {
    const dated = d.opportunities.filter((o) => o.deadline);
    if (dated.length) {
      lines.push(
        `DEADLINES: ${dated.slice(0, 3).map((o) => `"${o.subject}" closes ${o.deadline}`).join("; ")}`,
      );
    }
    const undated = d.opportunities.filter((o) => !o.deadline).slice(0, 2);
    if (undated.length) {
      lines.push(`CAREER MAIL: ${undated.map((o) => `${o.from} — "${o.subject}"`).join("; ")}`);
    }
  }
  /*
   * What the mail *says*, not how much of it there is.
   *
   * This read "4 unread emails waiting", which is a number he already knew
   * and could not act on. The ranked lines name the sender, the subject and
   * why it matters — the count stays as a second line, because "and eleven
   * others" is the part that tells him whether to open the mailbox at all.
   */
  if (d.importantMail.length) {
    lines.push(
      "MAIL THAT NEEDS HIM:\n" +
      d.importantMail
        .map((m) => `  · ${m.account === "outlook" ? "Outlook" : "Gmail"} — ${m.from}: "${m.subject}" (${m.urgency}) — ${m.why}`)
        .join("\n"),
    );
  }
  if (d.unread.length) {
    const g = d.unread.filter((e) => e.account === "gmail").length;
    const o = d.unread.length - g;
    lines.push(`EMAIL: ${d.unread.length} unread (${g} Gmail, ${o} Outlook) — ${d.unread.slice(0, 3).map((e) => `${e.from} on "${e.subject}"`).join("; ")}`);
  }

  if (d.markets.length) {
    lines.push(`MARKETS (24h): ${d.markets.map((m) => `${m.symbol} ${m.change24h == null ? "—" : `${m.change24h > 0 ? "+" : ""}${m.change24h.toFixed(1)}%`}`).join(", ")}`);
  }
  if (d.portfolio) {
    const p = d.portfolio;
    lines.push(
      `PORTFOLIO: worth ~${Math.round(p.value).toLocaleString()}, ${p.pnl >= 0 ? "up" : "down"} ${Math.abs(Math.round(p.pnl)).toLocaleString()} overall.` +
      (p.movers.length ? ` Biggest movers: ${p.movers.map((m) => `${m.symbol} ${(m.change24h ?? 0) > 0 ? "+" : ""}${(m.change24h ?? 0).toFixed(1)}%`).join(", ")}.` : ""),
    );
  }

  if (d.budget) {
    const b = d.budget;
    lines.push(
      `BUDGET: ₹${b.spent.toLocaleString("en-IN")} spent of ₹${b.planned.toLocaleString("en-IN")} planned, on pace for ₹${b.projected.toLocaleString("en-IN")}.` +
      (b.over.length ? ` Already over on ${b.over.join(", ")}.` : "") +
      (b.watch.length ? ` On pace to overshoot ${b.watch.join(", ")}.` : ""),
    );
  }

  if (d.weather) {
    lines.push(`WEATHER (${d.weather.place}): ${d.weather.label}, ${Math.round(d.weather.temp)}°, high ${Math.round(d.weather.high)}° low ${Math.round(d.weather.low)}°${d.weather.aqi != null ? `, AQI ${d.weather.aqi}` : ""}.`);
  }

  if (d.reminders.length) {
    lines.push(`REMINDERS: ${d.reminders.slice(0, 3).map((r) => `"${r.text}"${r.remindAt ? ` at ${hhmm(r.remindAt)}` : ""}`).join(", ")}`);
  }
  if (d.goals.length) {
    lines.push(`HIS STANDING GOALS (context for what matters — do not read these out as a list): ${d.goals.join("; ")}`);
  }

  if (d.training?.daysSinceLast != null) {
    lines.push(
      `TRAINING: last session ${d.training.daysSinceLast === 0 ? "today" : `${d.training.daysSinceLast} days ago`}, averaging ${d.training.perWeek}/week.` +
      (d.training.daysSinceLast >= 4 ? " Worth a nudge." : ""),
    );
  }

  return lines.join("\n");
}
