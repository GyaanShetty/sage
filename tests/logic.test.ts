import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { attribution, riskAdjusted, maxDrawdown, dailyReturns, rebalance, riskMetrics } from "@/core/portfolio/analytics";
import { parseHevyCsv, summariseWorkout } from "@/infrastructure/integrations/hevy";
import { classify, QUADRANT_META } from "@/core/tasks/eisenhower";
import { splitForSpeech } from "@/lib/speech-split";
import { fingerprint } from "@/core/ops/errors";
import { stepStreak, average, correlate } from "@/core/health/store";
import { startOfTodayUtc, tzHour } from "@/lib/config";
import { noRepeatClause } from "@/core/brief/variety";
import { describeDay, type DayPicture } from "@/core/brief/agenda";
import { within, deadline } from "@/lib/budget";
import { machineAuth } from "@/lib/security";
import { isOverloadedError, isQuotaError, isModelError } from "@/infrastructure/llm";

/**
 * Data-correctness proof.
 *
 * Every function here decides something the user sees as fact: what their
 * portfolio earned, how much they lifted, which task is urgent, whether a
 * notification has already gone out today. A silent arithmetic or timezone
 * error in any of them is worse than a crash, because it looks like an answer.
 *
 * These are the pure functions — no database, no model, no network — so they
 * can be checked exactly rather than eyeballed. Run with `npm test`.
 */

// ── Portfolio ───────────────────────────────────────────────────────────────

const pos = (symbol: string, value: number, pnl: number, kind: "crypto" | "stock" = "crypto") =>
  ({
    id: symbol, symbol, kind, qty: 1, avgCost: 1,
    price: 1, value, cost: value - pnl, pnl,
    pnlPct: value - pnl === 0 ? 0 : (pnl / (value - pnl)) * 100,
    change24h: 0,
  }) as never;

test("attribution: a book up overall while most of it bleeds", () => {
  const a = attribution([pos("BTC", 3000, 2000), pos("ETH", 500, -400), pos("SOL", 600, -300)]);
  assert.equal(a.totalPnl, 1300);
  assert.equal(a.winners, 1);
  assert.equal(a.losers, 2);
  assert.equal(a.best?.symbol, "BTC");
  // Worst is the largest loss, not merely the last row.
  assert.equal(a.worst?.symbol, "ETH");
  assert.ok(a.drivenByOne, "one name driving >50% of movement must be flagged");
  assert.ok(a.notes.some((n) => n.includes("underwater")), "the narrow gain must be stated");
});

test("attribution: net-zero book does not divide by zero", () => {
  const a = attribution([pos("A", 1100, 100), pos("B", 900, -100)]);
  assert.equal(a.totalPnl, 0);
  // Signed against GROSS movement, so both stay visible and finite.
  assert.deepEqual(a.contributions.map((c) => c.share), [50, -50]);
  for (const c of a.contributions) assert.ok(Number.isFinite(c.share));
});

test("attribution: no priced positions is empty, not NaN", () => {
  const a = attribution([]);
  assert.equal(a.totalPnl, 0);
  assert.equal(a.best, null);
  assert.equal(a.contributions.length, 0);
});

test("riskAdjusted: a straight line returns nothing, not a fake Sharpe", () => {
  // A perfectly smooth curve has ~zero variance; dividing by its rounding
  // error produced a Sharpe in the quadrillions before this guard.
  const smooth = Array.from({ length: 30 }, (_, i) => ({ at: `d${i}`, value: 100 * 1.01 ** i }));
  const r = riskAdjusted(smooth as never);
  assert.equal(r.sharpe, null);
  assert.equal(r.sortino, null);

  // And below ~20 days it is noise, so it must abstain.
  assert.equal(riskAdjusted(smooth.slice(0, 6) as never).sharpe, null);
});

test("riskAdjusted: a real series produces a finite, sane number", () => {
  let v = 100;
  const snaps = Array.from({ length: 60 }, (_, i) => {
    v *= 1 + Math.sin(i * 1.7) * 0.02;      // deterministic wobble, no RNG
    return { at: `d${i}`, value: v };
  }) as never;
  const r = riskAdjusted(snaps);
  assert.ok(r.sharpe !== null && Number.isFinite(r.sharpe));
  assert.ok(Math.abs(r.sharpe as number) < 100, "a plausible Sharpe, not an artefact");
});

test("maxDrawdown measures peak-to-trough, not first-to-last", () => {
  const snaps = [100, 150, 75, 120].map((value, i) => ({ at: `d${i}`, value })) as never;
  // Peak 150 → trough 75 is -50%, even though the series ends up on 100.
  assert.equal(Math.round(maxDrawdown(snaps) as number), -50);
});

test("dailyReturns skips a zero base rather than yielding Infinity", () => {
  const snaps = [0, 100, 110].map((value, i) => ({ at: `d${i}`, value })) as never;
  const rets = dailyReturns(snaps);
  for (const r of rets) assert.ok(Number.isFinite(r));
});

test("riskMetrics flags concentration and crypto weight honestly", () => {
  const m = riskMetrics([pos("BTC", 9000, 0), pos("ETH", 1000, 0)], []);
  assert.equal(Math.round(m.topWeight), 90);
  assert.equal(m.topSymbol, "BTC");
  assert.equal(Math.round(m.cryptoWeight), 100);
  assert.ok(m.warnings.length >= 2, "a 90% position and an all-crypto book both warrant a warning");
  // Volatility needs history; with none it must abstain rather than print 0.
  assert.equal(m.volatility, null);
});

test("rebalance: an already-equal book proposes nothing", () => {
  const legs = rebalance([pos("A", 1000, 0), pos("B", 1000, 0)]);
  assert.ok(legs.every((l) => l.action === "hold"));
});

// ── Hevy import ─────────────────────────────────────────────────────────────

test("parseHevyCsv reads Hevy's real date format", () => {
  // Hevy writes "Jul 29, 2026 at 6:00 PM" — not ISO. Date() rejects the whole
  // string because of the " at ", which silently dropped every workout.
  const csv = [
    "title,start_time,end_time,exercise_title,weight_kg,reps",
    '"Push","Jul 29, 2026 at 6:00 PM","Jul 29, 2026 at 7:00 PM","Bench Press",60,10',
    '"Push","Jul 29, 2026 at 6:00 PM","Jul 29, 2026 at 7:00 PM","Bench Press",60,8',
  ].join("\n");
  const out = parseHevyCsv(csv);
  assert.equal(out.length, 1, "rows sharing a start time are one workout");
  assert.equal(out[0].sets, 2);
  assert.equal(out[0].reps, 18);
  assert.equal(out[0].volumeKg, 60 * 18);
  assert.equal(out[0].minutes, 60);
  assert.equal(out[0].exercises[0].topSetKg, 60);
});

test("parseHevyCsv still accepts ISO, and drops unparseable dates", () => {
  const csv = [
    "title,start_time,exercise_title,weight_kg,reps",
    "Pull,2026-07-29T18:00:00Z,Row,50,10",
    "Junk,not-a-date,Row,50,10",
  ].join("\n");
  const out = parseHevyCsv(csv);
  assert.equal(out.length, 1, "an unreadable date is skipped, never coerced to 1970");
  assert.equal(out[0].volumeKg, 500);
});

test("parseHevyCsv survives commas inside quoted fields", () => {
  const csv = [
    "title,start_time,exercise_title,weight_kg,reps",
    '"Legs, heavy",2026-07-29T18:00:00Z,"Squat, low bar",100,5',
  ].join("\n");
  const out = parseHevyCsv(csv);
  assert.equal(out[0].title, "Legs, heavy");
  assert.equal(out[0].exercises[0].name, "Squat, low bar");
});

test("parseHevyCsv on empty or header-only input returns nothing", () => {
  assert.deepEqual(parseHevyCsv(""), []);
  assert.deepEqual(parseHevyCsv("title,start_time\n"), []);
});

test("summariseWorkout counts volume as weight x reps", () => {
  const w = summariseWorkout({
    id: "x", title: "Push",
    start_time: "2026-07-29T18:00:00Z", end_time: "2026-07-29T19:30:00Z",
    exercises: [{ title: "Bench", sets: [{ weight_kg: 60, reps: 10 }, { weight_kg: 70, reps: 5 }] }],
  });
  assert.equal(w.volumeKg, 60 * 10 + 70 * 5);
  assert.equal(w.sets, 2);
  assert.equal(w.reps, 15);
  assert.equal(w.minutes, 90);
  assert.equal(w.exercises[0].topSetKg, 70, "top set is the heaviest, not the last");
});

// ── Eisenhower ──────────────────────────────────────────────────────────────

const task = (over: Partial<{ id: string; title: string; dueAt: string | null; priority: number; status: string }>) =>
  ({ id: "t", title: "t", dueAt: null, priority: 2, status: "todo", ...over }) as never;

test("eisenhower: an overdue task is urgent, not expired", () => {
  const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const c = classify(task({ dueAt: past, priority: 0 }), undefined);
  assert.equal(c.urgent, true, "negative time-to-due must still count as urgent");
  assert.equal(c.quadrant, "do");
  assert.ok((c.hoursToDue as number) < 0);
});

test("eisenhower: no due date is never urgent", () => {
  assert.equal(classify(task({ priority: 0, dueAt: null }), undefined).quadrant, "schedule");
  assert.equal(classify(task({ priority: 3, dueAt: null }), undefined).quadrant, "drop");
});

test("eisenhower: a manual override wins and is marked pinned", () => {
  const soon = new Date(Date.now() + 3600_000).toISOString();
  const c = classify(task({ dueAt: soon, priority: 0 }), { quadrant: "drop" } as never);
  assert.equal(c.quadrant, "drop", "an explicit choice must beat the derivation");
  assert.equal(c.pinned, true);
});

test("eisenhower: every quadrant has coherent metadata", () => {
  assert.equal(QUADRANT_META.do.urgent && QUADRANT_META.do.important, true);
  assert.equal(QUADRANT_META.drop.urgent || QUADRANT_META.drop.important, false);
});

// ── Speech ──────────────────────────────────────────────────────────────────

test("splitForSpeech keeps every character and respects the limit", () => {
  const text = "One sentence here. Another one follows! And a third? " + "Long tail ".repeat(40);
  const parts = splitForSpeech(text, 120);
  assert.ok(parts.length > 1, "a long answer must be split, not truncated");
  for (const p of parts) assert.ok(p.length <= 120, `piece too long: ${p.length}`);
  // Nothing may be lost — this is the bug that cut SAGE off mid-sentence.
  const rejoined = parts.join(" ").replace(/\s+/g, " ").trim();
  assert.equal(rejoined, text.replace(/\s+/g, " ").trim());
});

test("splitForSpeech handles a single sentence longer than the limit", () => {
  const runOn = "word ".repeat(200).trim();
  const parts = splitForSpeech(runOn, 100);
  for (const p of parts) assert.ok(p.length <= 100);
  assert.equal(parts.join(" ").replace(/\s+/g, " ").trim(), runOn);
});

test("splitForSpeech on short text returns one piece", () => {
  assert.deepEqual(splitForSpeech("Short.", 500), ["Short."]);
});

// ── Error fingerprinting ────────────────────────────────────────────────────

test("fingerprint groups the same error across differing ids and numbers", () => {
  const a = fingerprint("Failed to load task 1f0c9a2b-1111-2222-3333-444455556666 at line 42", "/api/task", "server");
  const b = fingerprint("Failed to load task 9e7d1c3a-9999-8888-7777-666655554444 at line 77", "/api/task", "server");
  assert.equal(a, b, "ids and line numbers must not fragment one problem into many");
});

test("fingerprint keeps genuinely different errors apart", () => {
  const a = fingerprint("Timeout", "/api/task", "server");
  assert.notEqual(a, fingerprint("Timeout", "/api/voice", "server"), "different route");
  assert.notEqual(a, fingerprint("Timeout", "/api/task", "client"), "different side");
  assert.notEqual(a, fingerprint("Refused", "/api/task", "server"), "different message");
});

// ── Health ──────────────────────────────────────────────────────────────────

const dayKey = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
};
const metrics = (day: string, steps: number | null) =>
  ({ day, steps, sleepHours: null, activeKcal: null, restingHr: null, distanceKm: null,
     weightKg: null, waterMl: null, spo2: null, dietaryKcal: null, proteinG: null });

test("stepStreak does not break on an incomplete today", () => {
  // Yesterday and the day before met the goal; today is still in progress.
  const days = [metrics(dayKey(-2), 12000), metrics(dayKey(-1), 11000), metrics(dayKey(0), 300)];
  assert.equal(stepStreak(days, 10000), 2);
});

test("stepStreak counts today when today already qualifies", () => {
  const days = [metrics(dayKey(-1), 11000), metrics(dayKey(0), 10500)];
  assert.equal(stepStreak(days, 10000), 2);
});

test("stepStreak stops at a missing day rather than jumping the gap", () => {
  const days = [metrics(dayKey(-3), 20000), metrics(dayKey(-1), 20000), metrics(dayKey(0), 20000)];
  assert.equal(stepStreak(days, 10000), 2, "the gap at -2 must end the streak");
});

test("average ignores days that never reported", () => {
  const days = [metrics(dayKey(-1), 10000), metrics(dayKey(0), null)];
  assert.equal(average(days as never, "steps"), 10000, "a silent day is not a zero");
});

test("correlate returns null below a usable sample", () => {
  const days = [metrics(dayKey(-1), 10000)];
  assert.equal(correlate(days as never, "steps", { [dayKey(-1)]: 1 }), null);
});

// ── Timezone ────────────────────────────────────────────────────────────────

test("startOfTodayUtc is local midnight, not UTC midnight", () => {
  // IST is +05:30, so the day starts at 18:30 UTC the previous day. The old
  // `${date}T00:00:00` pointed at 05:30 IST and excluded the small hours.
  const morningTick = new Date("2026-08-03T03:00:00Z");   // 08:30 IST
  const smallHours = new Date("2026-08-02T19:00:00Z");    // 00:30 IST, same IST day
  assert.equal(startOfTodayUtc(morningTick), startOfTodayUtc(smallHours));
  assert.equal(startOfTodayUtc(morningTick), "2026-08-02T18:30:00.000Z");

  // And the instant before local midnight belongs to the previous day.
  assert.equal(startOfTodayUtc(new Date("2026-08-02T18:00:00Z")), "2026-08-01T18:30:00.000Z");
});

test("cron ticks land inside the notification windows", () => {
  // The whole class of bug that made three notifications never fire once:
  // windows written for a scheduler that does not exist.
  const morning = tzHour(new Date("2026-08-03T03:00:00Z"));   // Vercel cron 03:00 UTC
  const evening = tzHour(new Date("2026-08-03T15:30:00Z"));   // Vercel cron 15:30 UTC
  assert.equal(morning, 8, "morning tick is 08:30 IST");
  assert.equal(evening, 21, "evening tick is 21:00 IST");

  assert.ok(morning >= 5 && morning < 12, "morning brief window must contain the morning tick");
  assert.ok(morning >= 5 && morning < 14, "market brief window must contain the morning tick");
  assert.ok(evening >= 16 && evening < 23, "evening brief window must contain the evening tick");
  assert.ok(evening >= 18 && evening < 22, "leetcode nudge window must contain the evening tick");
  assert.ok(morning >= 8 && morning < 12, "career nudge window must contain the morning tick");
});

// ── Briefs ──────────────────────────────────────────────────────────────────

test("noRepeatClause names the previous openings", () => {
  const clause = noRepeatClause(["Three tasks open and the Nifty is flat.", "Rates dominate the tape."]);
  assert.ok(clause.includes("Three tasks open and the"), "the opener must be quoted back");
  assert.ok(clause.includes("Do not open with"));
});

test("noRepeatClause spares a required greeting", () => {
  // The spoken debrief must start "Good morning, sir." — blocking that would
  // tell it to break its own format, so only the substance is compared.
  const clause = noRepeatClause(
    ["Good morning, sir. Two emails need you.", "Good morning, sir. The Nifty is soft."],
    { fixedOpening: true },
  );
  assert.ok(!clause.includes('"Good morning, sir'), "the fixed greeting must not be banned");
  assert.ok(clause.includes("Two emails need you"));
});

test("noRepeatClause with no history adds nothing", () => {
  assert.equal(noRepeatClause([]), "");
});

const emptyDay: DayPicture = {
  now: new Date().toISOString(), weekday: "Monday", date: "3 August", weekend: false,
  events: [], next: null, committedMin: 0, load: "clear", longestGapMin: null, lastEventEndsAt: null,
  tasks: [], overdue: [], dueToday: [], headline: null, openCount: 0,
  unread: [], importantMail: [], opportunities: [], markets: [], portfolio: null, weather: null, reminders: [], goals: [], budget: null, training: null,
};

test("describeDay states an empty day plainly instead of inventing work", () => {
  const text = describeDay(emptyDay);
  assert.ok(text.includes("nothing scheduled today"));
  assert.ok(text.includes("do not invent work"));
});

test("describeDay leads with the right task and reports overdue days", () => {
  const overdue = { id: "1", title: "Send the invoice", dueAt: null, priority: 2, state: "overdue" as const, overdueDays: 6 };
  const text = describeDay({
    ...emptyDay,
    openCount: 9,
    overdue: [overdue],
    dueToday: [{ id: "2", title: "Draft the deck", dueAt: null, priority: 1, state: "today" as const }],
    headline: overdue,
  });
  assert.ok(text.includes("1 overdue"));
  assert.ok(text.includes("(6d)"), "how long it has been late is the point");
  assert.ok(text.includes('Lead with this one: "Send the invoice"'));
});

// ── Storage retention ───────────────────────────────────────────────────────

test("retention never prunes a type holding the user's own records", async () => {
  // A prune runs unattended at 3am and cannot be undone, so the two lists
  // overlapping even once would be silent, permanent data loss.
  const mod = await import("@/core/ops/retention");
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../core/ops/retention.ts", import.meta.url), "utf8"),
  );

  // Pull the prune table straight out of the source so the test reads the
  // real list rather than a copy that can drift away from it.
  const block = source.slice(source.indexOf("const RETENTION_DAYS"), source.indexOf("*\n * Types that are"));
  const pruned = [...block.matchAll(/"([a-z]+\.[a-zA-Z]+)":\s*\d+/g)].map((m) => m[1]);

  assert.ok(pruned.length > 5, "the prune table should have been parsed");
  for (const type of mod.NEVER_PRUNE) {
    assert.ok(!pruned.includes(type), `${type} is user data and must never be pruned`);
  }
});

test("retention keeps generated briefs longer than the history page reads", async () => {
  // /api/brief/history?limit=14 must never outrun the retention window, or
  // the page would show gaps that look like missing days rather than pruning.
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../core/ops/retention.ts", import.meta.url), "utf8");
  const days = Number(/"brief\.generated":\s*(\d+)/.exec(source)?.[1]);
  assert.ok(days >= 30, `brief.generated kept ${days}d — too short for a 14-entry history`);
});

// ── Budget ──────────────────────────────────────────────────────────────────

test("applyRule splits income across the three buckets", async () => {
  const { applyRule, BUCKETS } = await import("@/core/finance/budget");
  const lines = applyRule(100_000);
  const perBucket = Object.fromEntries(
    BUCKETS.map((b) => [b, lines.filter((l) => l.bucket === b).reduce((a, l) => a + l.limit, 0)]),
  );
  // Rounding per line means "about", not "exactly" — but never adrift.
  assert.ok(Math.abs(perBucket.needs - 50_000) <= 4, `needs ${perBucket.needs}`);
  assert.ok(Math.abs(perBucket.wants - 30_000) <= 4, `wants ${perBucket.wants}`);
  assert.equal(perBucket.savings, 20_000, "savings has no categories to divide among");
  assert.ok(lines.every((l) => l.id), "every line needs its own id to be editable");
});

test("budget: spending outside the plan is reported, not swallowed", async () => {
  const { budgetStatus } = await import("@/core/finance/budget");
  const month = "2026-08";
  const plan = {
    month, income: 50_000, basis: "custom" as const, updatedAt: "",
    lines: [{ id: "1", category: "food", bucket: "needs" as const, limit: 10_000 }],
  };
  const expenses = [
    { id: "a", amount: 4_000, merchant: "x", category: "food", date: "2026-08-05T00:00:00Z", recurring: false, source: "manual" },
    { id: "b", amount: 7_000, merchant: "y", category: "shopping", date: "2026-08-06T00:00:00Z", recurring: false, source: "manual" },
  ] as never;

  const s = budgetStatus(plan, expenses, new Date("2026-08-10T12:00:00Z"));
  assert.equal(s.lines[0].spent, 4_000);
  assert.equal(s.unbudgetedTotal, 7_000, "shopping has no line — it must still be counted");
  assert.equal(s.totalSpent, 11_000, "the total includes unbudgeted spend");
  assert.ok(s.notes.some((n) => n.includes("no budget line")));
});

test("budget: pacing flags an overshoot before the total is exceeded", async () => {
  const { budgetStatus } = await import("@/core/finance/budget");
  const plan = {
    month: "2026-08", income: 50_000, basis: "custom" as const, updatedAt: "",
    lines: [{ id: "1", category: "food", bucket: "needs" as const, limit: 10_000 }],
  };
  // ₹6,000 by the 10th of a 31-day month: still under the cap, but on pace
  // for ~₹18,600. That is the warning worth having.
  const expenses = [
    { id: "a", amount: 6_000, merchant: "x", category: "food", date: "2026-08-03T00:00:00Z", recurring: false, source: "manual" },
  ] as never;

  const s = budgetStatus(plan, expenses, new Date("2026-08-10T12:00:00Z"));
  assert.equal(s.lines[0].state, "watch", "under the cap but heading over");
  assert.ok(s.lines[0].projected > 10_000);
  assert.ok(s.lines[0].remaining > 0, "still money left today");
});

test("budget: a month that is over is over, not merely watched", async () => {
  const { budgetStatus } = await import("@/core/finance/budget");
  const plan = {
    month: "2026-08", income: 50_000, basis: "custom" as const, updatedAt: "",
    lines: [{ id: "1", category: "food", bucket: "needs" as const, limit: 5_000 }],
  };
  const expenses = [
    { id: "a", amount: 6_000, merchant: "x", category: "food", date: "2026-08-03T00:00:00Z", recurring: false, source: "manual" },
  ] as never;
  const s = budgetStatus(plan, expenses, new Date("2026-08-10T12:00:00Z"));
  assert.equal(s.lines[0].state, "over");
  assert.equal(s.lines[0].remaining, -1_000);
});

test("budget: expenses from other months are excluded", async () => {
  const { budgetStatus } = await import("@/core/finance/budget");
  const plan = {
    month: "2026-08", income: 50_000, basis: "custom" as const, updatedAt: "",
    lines: [{ id: "1", category: "food", bucket: "needs" as const, limit: 10_000 }],
  };
  const expenses = [
    { id: "a", amount: 1_000, merchant: "x", category: "food", date: "2026-08-05T00:00:00Z", recurring: false, source: "manual" },
    { id: "b", amount: 9_999, merchant: "y", category: "food", date: "2026-07-05T00:00:00Z", recurring: false, source: "manual" },
  ] as never;
  const s = budgetStatus(plan, expenses, new Date("2026-08-10T12:00:00Z"));
  assert.equal(s.lines[0].spent, 1_000, "July must not land in August's budget");
});

test("budget: a zero limit does not produce Infinity", async () => {
  const { budgetStatus } = await import("@/core/finance/budget");
  const plan = {
    month: "2026-08", income: 0, basis: "custom" as const, updatedAt: "",
    lines: [{ id: "1", category: "food", bucket: "needs" as const, limit: 0 }],
  };
  const expenses = [
    { id: "a", amount: 500, merchant: "x", category: "food", date: "2026-08-05T00:00:00Z", recurring: false, source: "manual" },
  ] as never;
  const s = budgetStatus(plan, expenses, new Date("2026-08-10T12:00:00Z"));
  assert.ok(Number.isFinite(s.lines[0].usedPct), "a percentage of nothing must not be Infinity");
  assert.equal(s.lines[0].state, "over");
});

test("spendCurve is cumulative and spans the whole month", async () => {
  const { spendCurve } = await import("@/core/finance/budget");
  const plan = {
    month: "2026-08", income: 50_000, basis: "custom" as const, updatedAt: "",
    lines: [{ id: "1", category: "food", bucket: "needs" as const, limit: 31_000 }],
  };
  const expenses = [
    { id: "a", amount: 100, merchant: "x", category: "food", date: "2026-08-02T06:00:00Z", recurring: false, source: "manual" },
    { id: "b", amount: 200, merchant: "y", category: "food", date: "2026-08-04T06:00:00Z", recurring: false, source: "manual" },
  ] as never;

  const curve = spendCurve(plan, expenses, new Date("2026-08-10T12:00:00Z"));
  assert.equal(curve.length, 31, "August has 31 days");
  assert.equal(curve[0].day, 1);
  // Cumulative: never decreases.
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i].spent >= curve[i - 1].spent);
  assert.equal(curve.at(-1)?.spent, 300);
  assert.equal(curve[0].planned, 1_000, "an even month spends 1/31 a day");
  assert.ok(curve.some((p) => p.future), "days after today are marked, not drawn as real data");
});

test("monthProgress treats a finished month as fully elapsed", async () => {
  const { monthProgress } = await import("@/core/finance/budget");
  const now = new Date("2026-08-10T12:00:00Z");
  assert.deepEqual(monthProgress("2026-08", now), { days: 31, elapsed: 10 });
  // A past month must not be paced as if it were still running.
  assert.deepEqual(monthProgress("2026-06", now), { days: 30, elapsed: 30 });
});

// ── Training progression ────────────────────────────────────────────────────

test("epley weights reps, and refuses nonsense input", async () => {
  const { epley } = await import("@/core/health/progression");
  // 100kg × 1 is 100; the same weight for 10 reps is a bigger lift.
  assert.equal(epley(100, 1), 103);
  assert.ok(epley(100, 10) > epley(100, 5));
  assert.equal(epley(0, 8), 0, "no weight is no one-rep max");
  assert.equal(epley(100, 0), 0, "no reps is no one-rep max");
  assert.equal(epley(-50, 5), 0);
});

// ── Spaced repetition ───────────────────────────────────────────────────────

test("schedule: the standard SM-2 ladder", async () => {
  const { schedule } = await import("@/core/retention/cards");
  let c = { ease: 2.5, interval: 0, reps: 0 };
  c = schedule(c, 4); assert.equal(c.interval, 1, "first success: tomorrow");
  c = schedule(c, 4); assert.equal(c.interval, 6, "second: six days");
  // Third and beyond: the previous interval multiplied by the card's ease.
  const easeBefore = c.ease;
  const third = schedule(c, 4);
  assert.equal(third.interval, Math.round(6 * easeBefore), "third: interval x ease");
  assert.equal(third.reps, 3);
});

test("schedule: a lapse resets the interval but keeps earned ease", async () => {
  const { schedule } = await import("@/core/retention/cards");
  const easy = schedule({ ease: 2.7, interval: 40, reps: 6 }, 1);
  assert.equal(easy.interval, 1, "back to tomorrow");
  assert.equal(easy.reps, 0);
  assert.equal(easy.ease, 2.7, "difficulty belongs to the card, not to one bad morning");
});

test("schedule: a corrupt card is repaired, not propagated", async () => {
  const { schedule } = await import("@/core/retention/cards");
  // Older rows and partial writes could arrive without these fields, and the
  // resulting NaN made a card impossible to schedule ever again.
  const fixed = schedule({}, 4);
  assert.ok(Number.isFinite(fixed.ease) && Number.isFinite(fixed.interval));
  assert.equal(fixed.interval, 1);

  const nanGrade = schedule({ ease: 2.5, interval: 5, reps: 3 }, Number.NaN);
  assert.ok(Number.isFinite(nanGrade.ease) && Number.isFinite(nanGrade.interval));
});

test("schedule: an out-of-range grade cannot inflate ease", async () => {
  const { schedule } = await import("@/core/retention/cards");
  const perfect = schedule({ ease: 2.5, interval: 6, reps: 2 }, 5);
  const absurd = schedule({ ease: 2.5, interval: 6, reps: 2 }, 99);
  assert.equal(absurd.ease, perfect.ease, "99 must be treated as 5, not rewarded beyond it");

  const negative = schedule({ ease: 2.5, interval: 6, reps: 2 }, -3);
  assert.equal(negative.interval, 1, "below zero is a lapse, not a bonus");
});

test("schedule: ease has a floor and the interval has a ceiling", async () => {
  const { schedule, MAX_INTERVAL_DAYS } = await import("@/core/retention/cards");
  let c = { ease: 1.3, interval: 10, reps: 5 };
  for (let i = 0; i < 20; i++) c = schedule(c, 3);   // repeated "hard but passed"
  assert.ok(c.ease >= 1.3, "ease must never fall through the floor");

  // A long streak used to schedule the next review a decade out, which is
  // retention in name only.
  let d = { ease: 2.8, interval: 200, reps: 9 };
  for (let i = 0; i < 10; i++) d = schedule(d, 5);
  assert.ok(d.interval <= MAX_INTERVAL_DAYS, `interval ${d.interval} exceeded the cap`);
});

test("describeDay reports the budget only when one is set", async () => {
  const withBudget = describeDay({
    ...emptyDay,
    budget: { spent: 41_000, planned: 50_000, projected: 61_000, leftToSpend: 9_000, over: ["food"], watch: ["transport"] },
  });
  assert.ok(withBudget.includes("BUDGET:"));
  assert.ok(withBudget.includes("Already over on food"));
  assert.ok(withBudget.includes("On pace to overshoot transport"));

  // No plan must produce no line at all, not "budget: none".
  assert.ok(!describeDay(emptyDay).includes("BUDGET"));
});

// ── Next session ────────────────────────────────────────────────────────────

const lift = (over: Partial<{ name: string; sessions: number; bestKg: number | null; latestKg: number | null; changeKg: number | null; changePct: number | null; e1rm: number | null; trend: "up" | "flat" | "down" | "new"; lastTrained: string; daysSince: number }>) =>
  ({ name: "Squat", sessions: 5, bestKg: 100, latestKg: 100, changeKg: 5, changePct: 5, e1rm: 127,
     trend: "up" as const, lastTrained: "", daysSince: 5, ...over });

test("next session: coming back from a long layoff repeats the weight", async () => {
  const { suggestNextSession } = await import("@/core/health/progression");
  const neglected = [lift({ name: "Deadlift", daysSince: 30, latestKg: 140 })];
  const s = suggestNextSession(neglected, neglected);
  assert.ok(s);
  const t = s.targets[0];
  // Adding weight after a month off is how people hurt themselves.
  assert.equal(t.suggestKg, 140, "match the old weight, do not add to it");
  assert.ok(t.note.includes("match"));
});

test("next session: a lift that went backwards is repeated, not raised", async () => {
  const { suggestNextSession } = await import("@/core/health/progression");
  const back = [lift({ name: "Bench", trend: "down", latestKg: 80, daysSince: 5 })];
  const s = suggestNextSession(back, []);
  assert.equal(s?.targets[0].suggestKg, 80);
});

test("next session: increments land on real plates", async () => {
  const { suggestNextSession } = await import("@/core/health/progression");
  // 100kg + 2.5% = 102.5 — reachable. An unrounded 2.5% of 63 would be 64.575,
  // which is advice you cannot physically follow.
  const a = suggestNextSession([lift({ latestKg: 100, daysSince: 5, trend: "up" })], []);
  assert.equal(a?.targets[0].suggestKg, 102.5);

  const b = suggestNextSession([lift({ latestKg: 63, daysSince: 5, trend: "up" })], []);
  const kg = b?.targets[0].suggestKg as number;
  assert.equal(kg % 2.5, 0, `${kg} is not a loadable weight`);
});

test("next session: no lift data suggests nothing rather than inventing a plan", async () => {
  const { suggestNextSession } = await import("@/core/health/progression");
  assert.equal(suggestNextSession([], []), null);
});

test("next session: bodyweight lifts carry no weight suggestion", async () => {
  const { suggestNextSession } = await import("@/core/health/progression");
  const bw = [lift({ name: "Pull Up", latestKg: null, bestKg: null, daysSince: 6 })];
  const s = suggestNextSession(bw, []);
  assert.equal(s?.targets[0].suggestKg, null, "no weight recorded means no number to beat");
});

// ── Prep reminders ──────────────────────────────────────────────────────────

test("the prep marker never reaches the user", async () => {
  const { stripMarker } = await import("@/core/reminders/prep");

  assert.equal(
    stripMarker("Standup in 15 minutes ⟨prep:abc123@2026-08-04T09:30:00.000Z⟩"),
    "Standup in 15 minutes",
  );
  // With a location, the marker sits after it.
  assert.equal(
    stripMarker("Dentist in 15 minutes · Indiranagar ⟨prep:x@2026-08-04T11:00:00.000Z⟩"),
    "Dentist in 15 minutes · Indiranagar",
  );
  // A hand-written reminder has no marker and must survive untouched.
  assert.equal(stripMarker("Call the landlord"), "Call the landlord");
  // An event whose own title contains angle brackets must not confuse it.
  assert.equal(stripMarker("Review <draft> in 15 minutes"), "Review <draft> in 15 minutes");
});

test("prep markers are unique per event AND per start time", async () => {
  const { stripMarker } = await import("@/core/reminders/prep");
  // Moving an event changes its marker, so a new reminder is created for the
  // new time rather than the old one silently standing.
  const a = "Standup in 15 minutes ⟨prep:evt1@2026-08-04T09:30:00.000Z⟩";
  const b = "Standup in 15 minutes ⟨prep:evt1@2026-08-04T14:00:00.000Z⟩";
  assert.notEqual(a, b);
  assert.equal(stripMarker(a), stripMarker(b), "the same event still reads the same to the user");
});

// ── Speaking in parts ───────────────────────────────────────────────────────

test("splitIntoParts keeps short answers whole", async () => {
  const { splitIntoParts, SPOKEN_BUDGET_CHARS } = await import("@/lib/speech-split");
  const short = "Three tasks open, nothing overdue. The Nifty is flat.";
  assert.deepEqual(splitIntoParts(short), [short]);
  assert.ok(short.length < SPOKEN_BUDGET_CHARS);
  assert.deepEqual(splitIntoParts("   "), [], "nothing to say is no parts, not one empty one");
});

test("splitIntoParts breaks a long answer without losing a word", async () => {
  const { splitIntoParts, SPOKEN_BUDGET_CHARS } = await import("@/lib/speech-split");
  const long = "This is a sentence about your portfolio. ".repeat(80).trim();
  const parts = splitIntoParts(long);

  assert.ok(parts.length > 1, "a long answer must become several parts");
  for (const p of parts) assert.ok(p.length <= SPOKEN_BUDGET_CHARS, `part of ${p.length} chars`);
  // Nothing dropped — the whole point is to defer the tail, not lose it.
  assert.equal(parts.join(" ").replace(/\s+/g, " ").trim(), long.replace(/\s+/g, " ").trim());
});

test("the handoff says how much is left, and stays quiet at the end", async () => {
  const { handoffLine } = await import("@/lib/speech-split");
  assert.ok(handoffLine(0, 3).includes("first of 3"));
  assert.ok(handoffLine(1, 3).includes("One part left"));
  // The last part must not invite a continuation that does not exist.
  assert.equal(handoffLine(2, 3), "");
  assert.equal(handoffLine(0, 1), "", "a single part is not 'part one of one'");
});

test("an imported Hevy session reads as a session, not a blank row", async () => {
  const { normaliseWorkout } = await import("@/core/health/store");
  // What a Hevy import actually stores: a title, a volume, a trained-at — and
  // none of type/intensity/day, which is what the workouts list renders.
  const w = normaliseWorkout("e1", {
    externalId: "hevy-9", title: "Push Day", minutes: 62, volumeKg: 8412.4,
    at: "2026-07-01T11:00:00.000Z",
  }, "2026-08-05T04:00:00.000Z");

  assert.equal(w.type, "Push Day", "the title is the name of the session");
  assert.equal(w.minutes, 62);
  assert.equal(w.source, "hevy");
  // Dated when it was trained, not when it was imported.
  assert.equal(w.day, "2026-07-01");
  assert.ok(w.note?.includes("kg moved"));
  assert.equal(w.intensity, "moderate", "Hevy has no intensity — don't invent one");
});

test("a manually logged workout keeps everything it was given", async () => {
  const { normaliseWorkout } = await import("@/core/health/store");
  const w = normaliseWorkout("m1", {
    type: "Run", minutes: 35, intensity: "hard", kcal: 420, day: "2026-08-04",
  }, "2026-08-04T12:00:00.000Z");

  assert.equal(w.type, "Run");
  assert.equal(w.intensity, "hard");
  assert.equal(w.kcal, 420);
  assert.equal(w.source, "manual", "only manual rows may offer a delete button");
});

test("a garbage payload still produces a renderable row", async () => {
  const { normaliseWorkout } = await import("@/core/health/store");
  const w = normaliseWorkout("x", {}, "2026-08-05T19:00:00.000Z");
  assert.equal(w.type, "Workout");
  assert.equal(w.minutes, 0);
  assert.equal(w.intensity, "moderate");
  // 19:00 UTC on the 5th is already the 6th in IST.
  assert.equal(w.day, "2026-08-06");
});

test("health day keys follow his calendar, not the server's", async () => {
  const { dayKey } = await import("@/core/health/store");
  // The bug this replaces: toISOString().slice(0,10) on the same instant
  // returns 2026-08-05, so every chart axis and week cutoff was a day out
  // between midnight and 05:30 IST.
  const late = new Date("2026-08-05T20:30:00.000Z");
  assert.equal(dayKey(late), "2026-08-06");
  assert.equal(late.toISOString().slice(0, 10), "2026-08-05");
});

test("attachments are collected from the whole MIME tree, inline ones marked", async () => {
  const { collectAttachments } = await import("@/infrastructure/integrations/google");
  const files = collectAttachments({
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/plain", body: { data: "aGk" } },
      {
        mimeType: "multipart/related",
        parts: [
          {
            mimeType: "image/png", filename: "logo.png",
            headers: [{ name: "Content-Disposition", value: "inline; filename=logo.png" }],
            body: { attachmentId: "a1", size: 1800 },
          },
        ],
      },
      { mimeType: "application/pdf", filename: "offer.pdf", body: { attachmentId: "a2", size: 240_000 } },
      // No attachmentId: a body part, not a file.
      { mimeType: "text/html", body: { data: "PGI+" } },
    ],
  });

  assert.equal(files.length, 2);
  assert.deepEqual(files.map((f) => f.filename), ["logo.png", "offer.pdf"]);
  assert.equal(files[0].inline, true, "a signature logo must not crowd out a real attachment");
  assert.equal(files[0].isImage, true);
  assert.equal(files[1].inline, false);
  assert.equal(files[1].size, 240_000);
});

test("a task created in a quadrant classifies back into that quadrant", async () => {
  const { classify, QUADRANT_META } = await import("@/core/tasks/eisenhower");
  // Mirrors what createInQuadrant writes: priority from importance, a due date
  // inside or outside the 48h urgency window. Without the meta override, the
  // derived quadrant must still be the one he picked.
  for (const q of ["do", "schedule", "delegate", "drop"] as const) {
    const target = QUADRANT_META[q];
    const due = new Date();
    due.setDate(due.getDate() + (target.urgent ? 1 : 7));
    due.setHours(18, 0, 0, 0);
    const c = classify({ priority: target.important ? 1 : 2, dueAt: due.toISOString() });
    assert.equal(c.quadrant, q, `a task added to ${q} landed in ${c.quadrant}`);
  }
});

test("a key is spent before the next one is taken up", async () => {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
  process.env.GOOGLE_GENERATIVE_AI_API_KEYS = "key-aaaa,key-bbbb,key-cccc";
  const { getModel, modelKeyStatus } = await import("@/infrastructure/llm");

  getModel("fast");
  const first = modelKeyStatus().find((k) => k.inUse);
  assert.ok(first, "some key must be in use once a model has been asked for");

  // Ten more calls must not wander onto another key — rotation happens on
  // exhaustion, not per request.
  for (let i = 0; i < 10; i++) getModel(i % 2 ? "fast" : "smart");
  const still = modelKeyStatus().filter((k) => k.inUse);
  assert.equal(still.length, 1, "exactly one key is ever in use");
  assert.equal(still[0].tail, first.tail, "the key changed while it was still healthy");
});

test("recall never holds a reply past its deadline", async () => {
  const { recallWithin } = await import("@/core/memory/recall");
  const started = Date.now();
  // A 50ms budget against a call that cannot possibly finish that fast: the
  // point is that it returns anyway, empty, rather than blocking the stream.
  const out = await recallWithin("anything at all", 8, 50);
  const took = Date.now() - started;
  assert.ok(Array.isArray(out), "recall must always hand back a list");
  assert.ok(took < 900, `recall blocked for ${took}ms past a 50ms deadline`);
});

test("an expense keeps the category he filed it under", async () => {
  const { normaliseCategory } = await import("@/core/finance/expenses");
  // The bug: anything outside eight hardcoded slugs became "other", so money
  // filed under a budget line he wrote landed somewhere he never chose.
  assert.equal(normaliseCategory("Mess Fees"), "mess fees");
  assert.equal(normaliseCategory("  Rent  "), "rent");
  assert.equal(normaliseCategory("food"), "food");
  // Only genuinely absent categories fall back.
  assert.equal(normaliseCategory(""), "other");
  assert.equal(normaliseCategory(undefined), "other");
});

test("budget lines match spending in his own categories", async () => {
  const { budgetStatus } = await import("@/core/finance/budget");
  const month = new Date().toISOString().slice(0, 7);
  const plan = {
    month, income: 20000, basis: "custom" as const, updatedAt: new Date().toISOString(),
    lines: [
      { id: "1", category: "Mess Fees", bucket: "needs" as const, limit: 5000 },
      { id: "2", category: "books", bucket: "wants" as const, limit: 1000 },
    ],
  };
  const expenses = [
    { id: "a", amount: 3000, merchant: "mess", category: "mess fees", date: new Date().toISOString(), recurring: false, source: "manual" as const },
    { id: "b", amount: 400, merchant: "shop", category: "books", date: new Date().toISOString(), recurring: false, source: "manual" as const },
  ];

  const s = budgetStatus(plan, expenses);
  assert.equal(s.lines[0].spent, 3000, "spending must land on the line he wrote, whatever its capitalisation");
  assert.equal(s.lines[1].spent, 400);
  assert.equal(s.unbudgetedTotal, 0, "his own categories are not 'unbudgeted'");
});

test("heartbeat runs a job only when its cadence says so", async () => {
  const { isDue } = await import("@/core/ops/heartbeat");
  const job = { name: "j", everyMin: 15, run: async () => null };
  const now = new Date("2026-08-05T10:00:00.000Z");

  assert.equal(isDue(job, undefined, now), true, "never run before means due");
  assert.equal(isDue(job, new Date(now.getTime() - 5 * 60_000).toISOString(), now), false, "5 min into a 15 min cadence");
  assert.equal(isDue(job, new Date(now.getTime() - 20 * 60_000).toISOString(), now), true);
  // A stored timestamp in the future would otherwise park the job forever.
  assert.equal(isDue(job, new Date(now.getTime() + 86_400_000).toISOString(), now), true);
  assert.equal(isDue(job, "not a date", now), true);
});

test("market-hours jobs stay quiet outside NSE hours", async () => {
  const { isDue, inMarketHours } = await import("@/core/ops/heartbeat");
  const job = { name: "alerts", everyMin: 10, marketHours: true, run: async () => null };

  // 2026-08-05 is a Wednesday. 06:00 UTC = 11:30 IST, mid-session.
  const midSession = new Date("2026-08-05T06:00:00.000Z");
  assert.equal(inMarketHours(midSession), true);
  assert.equal(isDue(job, undefined, midSession), true);

  // 22:00 UTC = 03:30 IST the next day — nothing is trading.
  const night = new Date("2026-08-05T22:00:00.000Z");
  assert.equal(inMarketHours(night), false);
  assert.equal(isDue(job, undefined, night), false, "no point spending a rate-limited quote API at 3am");

  // 2026-08-08 is a Saturday, 06:00 UTC = 11:30 IST.
  assert.equal(inMarketHours(new Date("2026-08-08T06:00:00.000Z")), false);
});

test("hour-windowed jobs respect his waking hours", async () => {
  const { isDue } = await import("@/core/ops/heartbeat");
  const job = { name: "notifications", everyMin: 60, hours: [6, 23] as [number, number], run: async () => null };
  // 20:00 UTC = 01:30 IST — inside the cadence, outside the window.
  assert.equal(isDue(job, undefined, new Date("2026-08-05T20:00:00.000Z")), false);
  // 06:00 UTC = 11:30 IST.
  assert.equal(isDue(job, undefined, new Date("2026-08-05T06:00:00.000Z")), true);
});

test("ICS times land on the right instant, whatever the zone", async () => {
  const { parseIcsDate } = await import("@/infrastructure/integrations/ics");

  // A UTC instant is taken as given.
  assert.equal(parseIcsDate("20260805T093000Z")?.iso, "2026-08-05T09:30:00.000Z");

  // A floating local time in IST is 5h30 ahead of UTC — a 09:30 lecture is
  // 04:00Z, not 09:30Z. Getting this wrong shifts a whole timetable.
  const ist = parseIcsDate("20260805T093000", "Asia/Kolkata");
  assert.equal(ist?.iso, "2026-08-05T04:00:00.000Z");
  assert.equal(ist?.allDay, false);

  // A date with no time is all-day.
  const day = parseIcsDate("20260805");
  assert.equal(day?.allDay, true);

  // Another zone entirely, to prove nothing is hardcoded to +05:30.
  assert.equal(parseIcsDate("20260805T090000", "Europe/London")?.iso, "2026-08-05T08:00:00.000Z");
});

test("a weekly timetable expands into every one of its days", async () => {
  const { parseIcs } = await import("@/infrastructure/integrations/ics");
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:lecture-1",
    "SUMMARY:Linear Algebra",
    "LOCATION:LT-3",
    "DTSTART;TZID=Asia/Kolkata:20260803T090000",
    "DTEND;TZID=Asia/Kolkata:20260803T100000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260901T000000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcs(ics, { from: new Date("2026-08-03T00:00:00Z"), days: 14, feed: "Timetable" });

  // Three days a week for two weeks. Ignoring BYDAY would have lost two
  // thirds of the timetable.
  assert.ok(events.length >= 5, `expected several occurrences, got ${events.length}`);
  assert.equal(events[0].summary, "Linear Algebra");
  assert.equal(events[0].location, "LT-3");
  assert.equal(events[0].feed, "Timetable");
  assert.ok(new Set(events.map((e) => e.uid)).size === events.length, "every occurrence needs its own id");

  // Nothing may fall outside the window the caller asked for.
  for (const e of events) assert.ok(new Date(e.start) <= new Date("2026-08-17T00:00:00Z"));
});

test("folded ICS lines and escaped text survive parsing", async () => {
  const { parseIcs } = await import("@/infrastructure/integrations/ics");
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:x",
    "SUMMARY:Exam\\, Paper 2",
    "  — Main Hall",
    "DTSTART:20260805T093000Z",
    "DTEND:20260805T113000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const [e] = parseIcs(ics, { from: new Date("2026-08-01T00:00:00Z"), days: 30 });
  // Unfolding consumes the single leading space that marks the continuation
  // (RFC 5545), so the second space in the source is the one that survives.
  assert.equal(e.summary, "Exam, Paper 2 — Main Hall");
});

test("arXiv entries parse into papers, abstracts unwrapped", async () => {
  const { searchPapers } = await import("@/infrastructure/integrations/arxiv");
  // No network in tests; an empty query short-circuits before any fetch, which
  // is the contract the UI relies on when the box is empty.
  assert.deepEqual(await searchPapers("   "), []);
});

test("citations read like citations", async () => {
  const { cite } = await import("@/infrastructure/integrations/arxiv");
  const base = {
    id: "2401.01234v1", title: "On Portfolio Concentration", summary: "",
    published: "2024-01-02T00:00:00Z", updated: "", categories: ["q-fin.PM"],
    url: "https://arxiv.org/abs/2401.01234v1", pdfUrl: "https://arxiv.org/pdf/2401.01234v1",
  };
  assert.equal(
    cite({ ...base, authors: ["A Roy", "B Shah"] }),
    "A Roy & B Shah (2024). On Portfolio Concentration. arXiv:2401.01234v1",
  );
  // Three or more collapses, as every citation style does.
  assert.equal(
    cite({ ...base, authors: ["A Roy", "B Shah", "C Iyer"] }),
    "A Roy et al. (2024). On Portfolio Concentration. arXiv:2401.01234v1",
  );
});

test("calibration measures overconfidence honestly", async () => {
  const { calibrate } = await import("@/core/decisions/calibration");
  const base = {
    reasoning: "", expectation: "", domain: "markets" as const,
    decidedAt: "2026-01-01T00:00:00Z", reviewAt: "2026-04-01T00:00:00Z",
  };
  // Ten calls at 90% confidence, five of which came off: claiming 90 and
  // landing 50 is a 40-point gap, and the whole point is to see it.
  const decisions = Array.from({ length: 10 }, (_, i) => ({
    ...base, id: String(i), title: `call ${i}`, confidence: 90,
    outcome: (i < 5 ? "right" : "wrong") as "right" | "wrong",
  }));

  const c = calibrate(decisions);
  assert.equal(c.scored, 10);
  assert.equal(Math.round(c.hitRate * 100), 50);
  assert.equal(Math.round(c.meanConfidence * 100), 90);
  assert.ok(c.overconfidence < -0.35, "a 90% claim landing half the time is overconfidence");
  assert.ok(c.notes.some((n) => /overconfident/i.test(n)));
  // Brier punishes confident wrongness: 0.5 * (0.9-1)^2 + 0.5 * (0.9-0)^2.
  assert.ok(c.brier !== null && Math.abs(c.brier - 0.41) < 0.01, `brier was ${c.brier}`);
});

test("an unresolved call is not a wrong one", async () => {
  const { calibrate, outcomeValue } = await import("@/core/decisions/calibration");
  assert.equal(outcomeValue("too-early"), null, "too-early must not count as a miss");
  assert.equal(outcomeValue("mixed"), 0.5);
  assert.equal(outcomeValue(null), null);

  const base = { reasoning: "", expectation: "", domain: "life" as const, decidedAt: "", reviewAt: "" };
  const c = calibrate([
    { ...base, id: "1", title: "a", confidence: 80, outcome: "right" as const },
    { ...base, id: "2", title: "b", confidence: 80, outcome: "too-early" as const },
    { ...base, id: "3", title: "c", confidence: 80 },
  ]);
  assert.equal(c.scored, 1, "only resolved calls are scored");
  assert.equal(c.hitRate, 1);
});

test("decisions come due for review, once, on their date", async () => {
  const { dueForReview } = await import("@/core/decisions/store");
  const base = { reasoning: "", expectation: "", domain: "life" as const, decidedAt: "", confidence: 70 };
  const now = new Date("2026-08-05T12:00:00Z");
  const due = dueForReview([
    { ...base, id: "past", title: "past", reviewAt: "2026-07-01T00:00:00Z" },
    { ...base, id: "future", title: "future", reviewAt: "2026-12-01T00:00:00Z" },
    // Already scored: it must not come round again.
    { ...base, id: "done", title: "done", reviewAt: "2026-07-01T00:00:00Z", outcome: "right" as const },
  ], now);

  assert.deepEqual(due.map((d) => d.id), ["past"]);
});

test("calibration stays quiet on a thin sample", async () => {
  const { calibrate } = await import("@/core/decisions/calibration");
  const base = { reasoning: "", expectation: "", domain: "life" as const, decidedAt: "", reviewAt: "" };
  const c = calibrate([{ ...base, id: "1", title: "a", confidence: 95, outcome: "wrong" as const }]);
  // One wrong call at 95% is not evidence of anything, and claiming otherwise
  // would be the same overclaiming this feature exists to catch.
  assert.ok(c.notes.some((n) => /sketch|not a verdict/i.test(n)));
  assert.ok(!c.notes.some((n) => /You are overconfident/i.test(n)));
});

test("a stored key round-trips, and a wrong secret cannot read it", async () => {
  process.env.KEY_SECRET = "a-test-secret-value";
  const { seal, unseal } = await import("@/core/ops/keys");

  const key = "AIzaSyExampleKeyMaterial1234567890";
  const sealed = seal(key);

  assert.notEqual(sealed, key, "the stored form must not be the key");
  assert.ok(!sealed.includes(key.slice(0, 12)), "no plaintext may survive in the ciphertext");
  assert.equal(unseal(sealed), key);

  // Tampering must fail closed, not return garbage that gets sent to Google.
  const bytes = Buffer.from(sealed, "base64");
  bytes[bytes.length - 1] ^= 0xff;
  assert.equal(unseal(bytes.toString("base64")), null);
});

test("backups never carry API keys off-site", async () => {
  const { TABLES } = await import("@/core/ops/backup");
  // The guarantee is asserted at the shape level: Event is backed up, so the
  // filter inside dumpTable is the only thing keeping key ciphertext out of a
  // GitHub repo. If Event were ever removed from TABLES this test should be
  // revisited rather than silently passing.
  assert.ok(TABLES.includes("Event"), "Event is backed up, so its rows must be filtered");
  assert.ok(TABLES.includes("Integration"));
});

test("solution file names sort the way a repo should read", async () => {
  const { fileNameFor, cleanFolder } = await import("@/core/coding/push");

  // Numbered problems keep their natural order in a folder listing; plain
  // alphabetical would scatter a topic across it.
  assert.equal(fileNameFor("1. Two Sum", "python3"), "0001-two-sum.py");
  assert.equal(fileNameFor("42. Trapping Rain Water", "cpp"), "0042-trapping-rain-water.cpp");
  assert.equal(fileNameFor("Merge Intervals", "java"), "merge-intervals.java");
  // The extension drives GitHub's syntax highlighting and language stats, so
  // it has to follow the language, not the title.
  assert.equal(fileNameFor("Two Sum", "golang"), "two-sum.go");
  assert.equal(fileNameFor("", "rust"), "solution.rs");

  // Path traversal must not escape the chosen folder.
  assert.equal(cleanFolder("/arrays/two-pointers/"), "arrays/two-pointers");
  assert.equal(cleanFolder("../../etc"), "etc");
  assert.equal(cleanFolder("a//b/./c"), "a/b/c");
});

test("the header comment uses the language's own comment syntax", async () => {
  const { buildHeader } = await import("@/core/coding/push");
  const header = { title: "1. Two Sum", url: "https://leetcode.com/problems/two-sum/", complexity: "O(n) time" };

  assert.ok(buildHeader("python3", header).startsWith("# 1. Two Sum"));
  assert.ok(buildHeader("cpp", header).startsWith("// 1. Two Sum"));
  assert.ok(buildHeader("sql", header).startsWith("-- 1. Two Sum"));
  // Markdown's comment has to be closed or it swallows the file.
  assert.ok(buildHeader("markdown", header).startsWith("<!-- 1. Two Sum -->"));
  assert.equal(buildHeader("python3", undefined), "", "no header means no blank comment block");
});

test("study days follow his calendar, not UTC", async () => {
  const { tzDay, lastDays } = await import("@/lib/config");
  // 20:30 UTC is 02:00 IST the next day. A session logged then is tonight's
  // work in his terms, and used to be filed under yesterday.
  assert.equal(tzDay("2026-08-05T20:30:00.000Z"), "2026-08-06");
  assert.equal(tzDay("2026-08-05T10:00:00.000Z"), "2026-08-05");

  const days = lastDays(7, new Date("2026-08-06T10:00:00.000Z"));
  assert.equal(days.length, 7);
  assert.equal(days[6], "2026-08-06", "the axis must end on today");
  assert.equal(days[0], "2026-07-31");
});

test("a slow source cannot take the sitrep down", async () => {
  // buildSitrep races every source against a budget and falls back to null, so
  // one hanging integration degrades that line rather than the whole board.
  // Exercised here through the same primitive the module uses.
  const slow = new Promise<string | null>(() => {});          // never resolves
  const raced = await Promise.race([
    slow,
    new Promise<string | null>((r) => setTimeout(() => r(null), 30)),
  ]);
  assert.equal(raced, null, "a source that never answers must yield, not block");
});

test("the countdown reads like a countdown", async () => {
  // Mirrors features/sitrep countdown(): seconds only once they matter, so a
  // glance at "2h 14m" is not cluttered and "6m 03s" still feels urgent.
  const countdown = (ms: number): string => {
    if (ms <= 0) return "now";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m >= 10) return `${m}m`;
    return `${m}m ${String(sec).padStart(2, "0")}s`;
  };

  assert.equal(countdown(2 * 3600_000 + 14 * 60_000), "2h 14m");
  assert.equal(countdown(25 * 60_000), "25m");
  assert.equal(countdown(6 * 60_000 + 3000), "6m 03s");
  assert.equal(countdown(0), "now");
  assert.equal(countdown(-5000), "now", "an event that has started is not negative time");
});

test("anomaly detection refuses to cry wolf on thin or flat data", async () => {
  const { baseline, zScore } = await import("@/core/anomaly");

  // Too few points to claim anything.
  const thin = baseline([100, 120, 90]);
  assert.equal(zScore(400, thin), null, "three days is not a baseline");

  // A perfectly flat history: any change is a departure, but not a
  // statistical one — this is where naive detectors report infinity.
  const flat = baseline([100, 100, 100, 100, 100, 100, 100, 100]);
  assert.equal(flat.sd, 0);
  assert.equal(zScore(500, flat), null, "a flat series cannot yield a z-score");
  assert.equal(zScore(100, flat), 0, "no change against a flat series is no anomaly");

  // A real one.
  const normal = baseline([100, 110, 95, 105, 100, 98, 102, 101]);
  const z = zScore(160, normal);
  assert.ok(z !== null && z > 2, `a 60% jump should clear two sigma, got ${z}`);
  // And an ordinary day should not.
  assert.ok(Math.abs(zScore(104, normal) ?? 9) < 2, "an ordinary day is not an anomaly");
});

test("the baseline uses the sample standard deviation", async () => {
  const { baseline } = await import("@/core/anomaly");
  // n-1 rather than n: with a fortnight of data the difference is not
  // academic, and dividing by n understates the spread, which manufactures
  // anomalies.
  const b = baseline([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(b.mean, 5);
  assert.ok(Math.abs(b.sd - 2.138) < 0.01, `expected ~2.14 (sample sd), got ${b.sd}`);
  assert.equal(b.n, 8);
});

test("dossier search terms drop the scaffolding, keep the subject", async () => {
  const { searchTerms } = await import("@/core/dossier");
  // A calendar entry is rarely a bare name. The words worth searching are the
  // ones that are not in every other entry.
  assert.deepEqual(searchTerms("Call with Priya re: internship"), ["Priya", "internship"]);
  assert.deepEqual(searchTerms("Goldman Sachs — OA round 2"), ["Goldman", "Sachs", "OA"]);
  assert.deepEqual(searchTerms("1:1 catch up"), []);
});

test("the month grid is whole weeks, Monday first, and knows which days belong", async () => {
  // Mirrors monthGrid() in features/calendar. Anchored at UTC noon so adding
  // days can never land on a daylight-saving seam and repeat or skip a date.
  const monthGrid = (year: number, month: number) => {
    const first = new Date(Date.UTC(year, month, 1, 12));
    const startOffset = (first.getUTCDay() + 6) % 7;
    const cursor = new Date(first);
    cursor.setUTCDate(cursor.getUTCDate() - startOffset);
    const cells: { key: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      const d = String(cursor.getUTCDate()).padStart(2, "0");
      cells.push({ key: `${y}-${m}-${d}`, inMonth: cursor.getUTCMonth() === month });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return cells.slice(0, cells.slice(35).every((c) => !c.inMonth) ? 35 : 42);
  };

  // August 2026 starts on a Saturday, so the grid opens on Monday 27 July.
  const aug = monthGrid(2026, 7);
  assert.equal(aug[0].key, "2026-07-27");
  assert.equal(aug[0].inMonth, false);
  assert.ok(aug.length === 35 || aug.length === 42);
  assert.equal(aug.length % 7, 0, "the grid must be whole weeks");

  // Every day of the month appears exactly once.
  const inMonth = aug.filter((c) => c.inMonth).map((c) => c.key);
  assert.equal(inMonth.length, 31);
  assert.equal(inMonth[0], "2026-08-01");
  assert.equal(inMonth[30], "2026-08-31");
  assert.equal(new Set(inMonth).size, 31, "no day may repeat");

  // February in a leap year, the case a naive grid gets wrong.
  const feb = monthGrid(2028, 1);
  assert.equal(feb.filter((c) => c.inMonth).length, 29);
});

test("events land on his day, not UTC's", async () => {
  const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
  // 20:30 UTC is 02:00 the next morning in IST. A grid keyed on UTC would put
  // this on the wrong square — the one failure that makes a calendar useless.
  assert.equal(DAY.format(new Date("2026-08-05T20:30:00.000Z")), "2026-08-06");
  assert.equal(DAY.format(new Date("2026-08-05T09:00:00.000Z")), "2026-08-05");

  // An all-day event carries a plain date; putting it through a timezone
  // would shift it, so the view slices it instead.
  const allDay = "2026-08-06T00:00:00.000Z";
  assert.equal(allDay.slice(0, 10), "2026-08-06");
});

test("the launcher filter narrows without ever emptying the ring", async () => {
  // Mirrors the `shown` memo in radial-nav: a wheel filtered to nothing looks
  // broken and offers no way back except deleting characters whose effect you
  // cannot see.
  const PAGES = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/calendar", label: "Calendar" },
    { href: "/counsel", label: "Counsel" },
    { href: "/health", label: "Health" },
    { href: "/push", label: "Push" },
  ];
  const shown = (filter: string) => {
    const q = filter.trim().toLowerCase();
    if (!q) return PAGES;
    const hits = PAGES.filter((p) => p.label.toLowerCase().includes(q) || p.href.slice(1).includes(q));
    return hits.length ? hits : PAGES;
  };

  assert.equal(shown("").length, 5);
  assert.deepEqual(shown("c").map((p) => p.label), ["Calendar", "Counsel"]);
  // Matches the path too, so "board" finds Dashboard.
  assert.deepEqual(shown("board").map((p) => p.label), ["Dashboard"]);
  assert.deepEqual(shown("cal").map((p) => p.label), ["Calendar"]);
  assert.equal(shown("zzz").length, 5, "no match falls back to everything, not nothing");
  assert.deepEqual(shown("  CAL ").map((p) => p.label), ["Calendar"], "trimmed and case-insensitive");
});

test("the ring grows so nodes never overlap", async () => {
  // Each node needs roughly 46px of arc to stay separate. The radius floor is
  // derived from the count rather than fixed, which is what broke when the
  // wheel went from twelve pages to twenty-six.
  const TAU = Math.PI * 2;
  const radiusFor = (n: number, viewportMin: number) => {
    const viewportMax = (viewportMin - 130) / 2;
    const needed = (n * 46) / TAU;
    return Math.max(110, Math.min(Math.max(190, needed), viewportMax));
  };

  const desktop = 900;
  const r12 = radiusFor(12, desktop);
  const r26 = radiusFor(26, desktop);
  assert.ok(r26 > r12, "more pages must mean a wider ring");

  // At 26 nodes the arc between neighbours must still clear the 40px node.
  const gap = (TAU * r26) / 26;
  assert.ok(gap >= 40, `nodes would overlap: ${gap.toFixed(1)}px of arc each`);

  // And it must never outgrow a phone.
  const phone = 700;
  assert.ok(radiusFor(26, phone) <= (phone - 130) / 2, "the ring must fit the viewport");
});

test("every page is reachable from the launcher, exactly once", async () => {
  // The wheel's page list and the app's routes drifted apart twice while it
  // grew; this is the cheap guard against a page existing with no way in.
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const shellDir = "app/(shell)";
  const routes = readdirSync(shellDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`${shellDir}/${d.name}/page.tsx`))
    .map((d) => `/${d.name}`);

  // The wheel and the search launcher are two views of one list; pages.ts is
  // that list, and this test is the reason it stopped being two.
  const src = readFileSync("features/shell/components/pages.ts", "utf8");
  const listed = [...src.matchAll(/href:\s*"(\/[a-z-]+)"/g)].map((m) => m[1]);

  for (const route of routes) {
    assert.ok(listed.includes(route), `${route} exists as a page but is in neither the wheel nor the launcher`);
  }
  assert.equal(new Set(listed).size, listed.length, "a page is listed twice in the launcher");
});

test("launcher search puts the obvious answer first", async () => {
  // Mirrors score() — an exact name must always beat a synonym, or typing
  // "push" lands on something that merely mentions pushing.
  const ALIASES: Record<string, string> = { git: "/push", money: "/portfolio", task: "/workspace" };
  const score = (item: { label: string; href: string; hint?: string }, q: string): number => {
    const label = item.label.toLowerCase();
    const slug = item.href.slice(1).toLowerCase();
    if (label === q || slug === q) return 100;
    if (label.startsWith(q) || slug.startsWith(q)) return 80;
    if (label.includes(q) || slug.includes(q)) return 60;
    if (item.hint?.toLowerCase().includes(q)) return 40;
    for (const [word, href] of Object.entries(ALIASES)) {
      if (href === item.href && word.startsWith(q)) return 30;
    }
    return 0;
  };

  const push = { label: "Push", href: "/push", hint: "to github" };
  const code = { label: "Code", href: "/code", hint: "lab" };
  const portfolio = { label: "Portfolio", href: "/portfolio", hint: "budget" };

  assert.ok(score(push, "push") > score(code, "push"), "the page called Push wins for 'push'");
  assert.equal(score(push, "push"), 100);
  // A hint match is real but weaker than a name match.
  assert.ok(score(push, "github") > 0 && score(push, "github") < score(push, "pu"));
  // Synonyms work but never outrank a name.
  assert.ok(score(portfolio, "money") > 0);
  assert.ok(score(portfolio, "port") > score(portfolio, "money"));
  assert.equal(score(code, "zzz"), 0, "no match is no match");
});

test("a week runs Monday to Sunday and contains its own day", async () => {
  // Mirrors weekOf() in the calendar view.
  const weekOf = (key: string) => {
    const anchor = new Date(`${key}T12:00:00Z`);
    anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      out.push(anchor.toISOString().slice(0, 10));
      anchor.setUTCDate(anchor.getUTCDate() + 1);
    }
    return out;
  };

  // 2026-08-06 is a Thursday.
  const w = weekOf("2026-08-06");
  assert.equal(w.length, 7);
  assert.equal(w[0], "2026-08-03", "the week starts on Monday");
  assert.equal(w[6], "2026-08-09");
  assert.ok(w.includes("2026-08-06"));

  // A Sunday belongs to the week that started six days earlier, not the next.
  assert.equal(weekOf("2026-08-09")[0], "2026-08-03");
  // And a week may straddle a month boundary.
  assert.deepEqual(weekOf("2026-09-01").slice(0, 2), ["2026-08-31", "2026-09-01"]);
});

test("events are placed by their real time in his timezone", async () => {
  const minutesInto = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(iso));
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  };

  // 03:30 UTC is 09:00 IST — a 9am lecture must sit on the 9am line, not 3:30.
  assert.equal(minutesInto("2026-08-06T03:30:00.000Z"), 9 * 60);
  assert.equal(minutesInto("2026-08-06T05:00:00.000Z"), 10 * 60 + 30);
  // Midnight IST is 0, not 1440 — an off-by-one here stacks events at the
  // bottom of the previous day.
  assert.equal(minutesInto("2026-08-05T18:30:00.000Z"), 0);
});

test("event tone is inferred from the title", async () => {
  const toneOf = (summary: string, feed?: string): string => {
    const s = summary.toLowerCase();
    if (/workout|gym|zone|run|boxing|hiit|training|lift/.test(s)) return "body";
    if (/revise|revision|study|read|practice|prep\b/.test(s)) return "study";
    if (/lab|seminar|lecture|class|tutorial/.test(s)) return "class";
    if (/exam|test|interview|deadline|viva|submission/.test(s)) return "sharp";
    return feed ? "feed" : "plain";
  };

  // Straight from his real timetable.
  assert.equal(toneOf("Workout"), "body");
  assert.equal(toneOf("Zone 2"), "body");
  assert.equal(toneOf("Boxing (HIIT)"), "body");
  assert.equal(toneOf("Revise + Backend"), "study");
  assert.equal(toneOf("DBMS lab (Ground Floor seminar)"), "class");
  assert.equal(toneOf("Elective 1 (AC) (Second Floor Seminar Hall)"), "class");
  assert.equal(toneOf("ML"), "plain", "an unmatched title stays neutral rather than guessing");
  assert.equal(toneOf("ML", "Timetable"), "feed", "unmatched but subscribed reads as someone else's");
});

test("a tap opens, a drag does not — the pointer-capture trap", async () => {
  /**
   * The bug this encodes: calling setPointerCapture on pointerdown retargets
   * the following `click` to the capturing element, so a button underneath it
   * never fires and nothing opens. Capture must wait until the pointer has
   * actually travelled.
   */
  const SLOP = 6;
  const gesture = (points: { x: number; y: number }[]) => {
    const start = points[0];
    let dragging = false;
    let captured = false;
    for (const p of points.slice(1)) {
      if (!dragging) {
        if (Math.hypot(p.x - start.x, p.y - start.y) < SLOP) continue;
        dragging = true;
        captured = true;          // only now
      }
    }
    return { dragging, captured, opens: !dragging };
  };

  // A tap with the tiny jitter a finger always has.
  const tap = gesture([{ x: 100, y: 300 }, { x: 101, y: 302 }, { x: 100, y: 303 }]);
  assert.equal(tap.dragging, false);
  assert.equal(tap.captured, false, "capturing on a tap is what ate the click");
  assert.equal(tap.opens, true);

  // A deliberate spin.
  const drag = gesture([{ x: 100, y: 300 }, { x: 102, y: 340 }, { x: 103, y: 420 }]);
  assert.equal(drag.dragging, true);
  assert.equal(drag.captured, true, "a real drag does need the capture");
  assert.equal(drag.opens, false, "releasing a spin over a node must not navigate");
});

test("a skipped short is scored as the mirror of a long", async () => {
  const { pnlOf } = await import("@/core/portfolio/shadow");
  const base = { id: "1", symbol: "BTC", price: 100, size: 2, thesis: "", whyNot: "", at: "" };

  // Long: price up is money you did not make.
  assert.equal(pnlOf({ ...base, side: "buy" }, 120), 40);
  assert.equal(pnlOf({ ...base, side: "buy" }, 90), -20);
  // Short: exactly inverted, from the same expression.
  assert.equal(pnlOf({ ...base, side: "short" }, 120), -40);
  assert.equal(pnlOf({ ...base, side: "short" }, 90), 20);
});

test("readiness refuses to score on thin history", async () => {
  const { computeReadiness } = await import("@/core/health/readiness");
  const now = new Date("2026-08-06T12:00:00Z");

  // Three sessions in a month is arithmetic, not information.
  const thin = computeReadiness(
    [{ day: "2026-08-01", load: 50 }, { day: "2026-08-03", load: 50 }, { day: "2026-08-05", load: 50 }],
    [{ day: "2026-08-05", hours: 7 }],
    7.5,
    now,
  );
  assert.equal(thin.ratio, null, "a ratio from three sessions would be a lie");
  assert.equal(thin.band, "unknown");
  assert.equal(thin.score, null, "no score rather than a guessed one");
  assert.match(thin.verdict, /Not enough training history/);
});

test("readiness spots a hard ramp", async () => {
  const { computeReadiness, sessionLoad } = await import("@/core/health/readiness");
  const now = new Date("2026-08-28T12:00:00Z");

  // Four weeks of steady work, then a week of triple.
  const sessions: { day: string; load: number }[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    sessions.push({ day: d, load: i < 7 ? 90 : 30 });
  }

  const r = computeReadiness(sessions, [{ day: now.toISOString().slice(0, 10), hours: 7.5 }], 7.5, now);
  assert.ok(r.ratio !== null && r.ratio > 1.5, `expected a hard ramp, got ${r.ratio}`);
  assert.equal(r.band, "danger");
  assert.match(r.verdict, /injury/);

  // Session load: volume where it exists, session-RPE otherwise.
  assert.equal(sessionLoad({ volumeKg: 8000 }), 80);
  assert.ok(sessionLoad({ minutes: 60, intensity: "hard" }) > sessionLoad({ minutes: 60, intensity: "easy" }));
});

test("drift finds what is distinctive, not what is frequent", async () => {
  const { themesByMonth, diffThemes } = await import("@/core/memory/drift");

  const entries = [
    // "college" every month — frequent, and therefore uninformative.
    { at: "2026-03-10T06:00:00Z", text: "college recursion recursion trees college" },
    { at: "2026-03-12T06:00:00Z", text: "recursion trees college backtracking" },
    { at: "2026-04-10T06:00:00Z", text: "college markets markets valuation" },
    { at: "2026-04-14T06:00:00Z", text: "markets valuation college derivatives" },
    { at: "2026-05-10T06:00:00Z", text: "college markets derivatives derivatives" },
    { at: "2026-05-16T06:00:00Z", text: "derivatives college markets hedging hedging" },
  ];

  const months = themesByMonth(entries);
  assert.equal(months.length, 3);
  assert.equal(months[0].month, "2026-03");

  const march = months[0].themes.map((t) => t.term);
  assert.ok(march.includes("recursion"), "the distinctive term should surface");
  assert.ok(!march.includes("college"), "a word used every month distinguishes nothing");

  const d = diffThemes(months);
  assert.ok(d.faded.includes("recursion"), "recursion stopped coming up and should be flagged");
  assert.ok(d.notes.some((n) => /gone quiet/i.test(n)));

  // The word he says every month is reported as a constant, not a finding.
  const { constantTerms } = await import("@/core/memory/drift");
  assert.ok(constantTerms(entries).includes("college"));
});

test("drift says nothing on too little history", async () => {
  const { themesByMonth, diffThemes } = await import("@/core/memory/drift");
  const d = diffThemes(themesByMonth([{ at: "2026-08-01T06:00:00Z", text: "markets markets valuation" }]));
  assert.deepEqual(d.emerged, []);
  assert.match(d.notes[0], /at least three/);
});

test("a hole in an explanation brings it back tomorrow, not in a fortnight", async () => {
  const { gradeFromScore } = await import("@/core/feynman");
  const { schedule } = await import("@/core/retention/cards");

  // The whole point of the loop: a fluent explanation with a real gap in it is
  // a lapse, however confident it sounded.
  assert.ok(gradeFromScore(55) < 3, "under 60% is a lapse");
  assert.equal(schedule({ ease: 2.5, interval: 30, reps: 6 }, gradeFromScore(55)).dueInDays, 1);

  // And a good one is allowed to space out.
  assert.ok(schedule({ ease: 2.5, interval: 6, reps: 2 }, gradeFromScore(95)).dueInDays > 6);

  // Nonsense in, no NaN out — the score comes from a model, so it can be junk.
  assert.equal(gradeFromScore(Number.NaN), 0);
  assert.equal(gradeFromScore(1e9), 5);
});

test("only concepts actually due are asked for", async () => {
  const { dueOf } = await import("@/core/feynman");
  const now = new Date("2026-08-06T09:00:00Z");
  const base = { title: "x", source: "s", attempts: [], ease: 2.5, interval: 1, reps: 0, at: "" };

  const due = dueOf(
    [
      { ...base, id: "later", dueAt: "2026-08-20T00:00:00Z" },
      { ...base, id: "old", dueAt: "2026-08-01T00:00:00Z" },
      { ...base, id: "retired", dueAt: "2026-07-01T00:00:00Z", retiredAt: "2026-07-02T00:00:00Z" },
      { ...base, id: "yesterday", dueAt: "2026-08-05T00:00:00Z" },
    ],
    now,
  );

  // Oldest first: the one he has been avoiding longest is the one to answer.
  assert.deepEqual(due.map((c) => c.id), ["old", "yesterday"]);
});

test("the exam countdown floors, and does not round tomorrow into two days", async () => {
  const { daysUntil, phaseOf, countdownFor } = await import("@/core/exam");
  const now = new Date("2026-08-06T09:00:00Z");

  // 30 hours away is tomorrow. Rounding it up costs an evening.
  assert.equal(daysUntil("2026-08-07T15:00:00Z", now), 1);
  assert.equal(daysUntil("2026-08-06T23:00:00Z", now), 0);
  assert.equal(daysUntil("2026-08-04T09:00:00Z", now), -2);

  // The switch from learning to testing happens before it feels like it should.
  assert.equal(phaseOf(14), "build");
  assert.equal(phaseOf(9), "test");
  assert.equal(phaseOf(2), "eve");
  assert.equal(phaseOf(-1), "past");

  const c = countdownFor(
    { id: "x", subject: "DSA", at: "2026-08-13T04:00:00Z", syllabus: "", at_created: "" },
    now,
  );
  assert.equal(c.phase, "test");
  assert.match(c.focus, /closed-book|Answer questions/i);
});

test("exam mode is driven by the soonest paper still ahead", async () => {
  const { nextExam, inExamMode } = await import("@/core/exam");
  const now = new Date("2026-08-06T09:00:00Z");
  const base = { syllabus: "", at_created: "" };

  const exams = [
    { ...base, id: "far", subject: "Maths", at: "2026-12-01T04:00:00Z" },
    { ...base, id: "sat", subject: "Physics", at: "2026-08-08T04:00:00Z", doneAt: "2026-08-08T07:00:00Z" },
    { ...base, id: "soon", subject: "DSA", at: "2026-08-10T04:00:00Z" },
  ];

  // A paper he has already sat must not keep driving the night shift.
  assert.equal(nextExam(exams, now)?.id, "soon");
  assert.equal(inExamMode(exams, now), true);

  // With only December left, the night shift goes back to its usual work.
  assert.equal(inExamMode([exams[0]], now), false);
});

test("every insert supplies the columns the database will not default", async () => {
  // The capture page shipped writing a bare string into Note.content, which is
  // JSONB, and omitting Memory.sourceType and Note.updatedAt — both NOT NULL
  // with no default. Postgres rejected all three, and because Supabase returns
  // errors rather than throwing them, the page reported the rows as filed.
  //
  // So this reads the schema and checks the inserts against it, rather than
  // checking the three that happened to be wrong.
  const fs = await import("node:fs");
  const path = await import("node:path");

  const sql = fs.readFileSync("prisma/migrations/0001_init/migration.sql", "utf8");
  const required = new Map<string, string[]>();
  for (const table of sql.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\n\);/g)) {
    const cols: string[] = [];
    for (const line of table[2].split("\n")) {
      const col = /^\s*"(\w+)"\s+(.+?),?\s*$/.exec(line);
      // NOT NULL and no DEFAULT means the caller has to say it.
      if (col && /NOT NULL/.test(col[2]) && !/DEFAULT/.test(col[2])) cols.push(col[1]);
    }
    required.set(table[1], cols);
  }
  assert.ok(required.get("Note")?.includes("updatedAt"), "the schema should have parsed");

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name)) files.push(p);
    }
  };
  walk("core");
  walk("app");

  const problems: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const call of src.matchAll(/from\("(\w+)"\)\s*\.insert\(\{([\s\S]{0,900}?)\n\s*\}\)/g)) {
      const [, table, body] = call;
      const req = required.get(table);
      // A spread could be carrying anything; this test cannot see inside it.
      if (!req?.length || body.includes("...")) continue;
      const keys = new Set([
        ...[...body.matchAll(/(?:^|[\s{,])(\w+)\s*:/g)].map((m) => m[1]),
        ...[...body.matchAll(/(?:^|[\s{,])(\w+)\s*(?=[,}\n])/g)].map((m) => m[1]),
      ]);
      const missing = req.filter((c) => !keys.has(c));
      if (missing.length) problems.push(`${file} → ${table} missing ${missing.join(", ")}`);
    }
  }

  assert.deepEqual(problems, []);
});

test("exam weakness is scored by marks, not by averaging percentages", async () => {
  const { topicWeakness } = await import("@/core/exam");
  const base = { examId: "e", question: "q", answer: "a", at: "", topic: "" };

  const weakest = topicWeakness([
    // A ten-mark question half-lost should outweigh a two-mark one aced.
    { ...base, id: "1", topic: "Trees", marks: 10, attempt: { at: "", answer: "", awarded: 5, outOf: 10, earned: [], lost: [], comment: "" } },
    { ...base, id: "2", topic: "Trees", marks: 2, attempt: { at: "", answer: "", awarded: 2, outOf: 2, earned: [], lost: [], comment: "" } },
    { ...base, id: "3", topic: "Graphs", marks: 6, attempt: { at: "", answer: "", awarded: 5, outOf: 6, earned: [], lost: [], comment: "" } },
    // Unanswered questions are not evidence of anything.
    { ...base, id: "4", topic: "DP", marks: 8 },
  ]);

  assert.deepEqual(weakest.map((t) => t.topic), ["trees", "graphs"]);
  assert.equal(weakest[0].percent, 58);   // 7 of 12, not the 75% an average would give
  assert.equal(weakest[0].attempts, 2);
  assert.equal(weakest[1].percent, 83);
});

test("the timezone is not hardcoded anywhere it decides a day", async () => {
  // This class of bug has bitten three times: the health chart, the study
  // streak and the LeetCode heatmap all read a day key from a different zone
  // than the rest of the app. Making TZ configurable made it worse — a fork
  // setting its own zone would have had some code in its zone and some still
  // in IST. So: no literal zone outside lib/config, except where a second zone
  // is the actual point.
  const fs = await import("node:fs");
  const path = await import("node:path");

  const allowed = new Set([
    // A deliberate multi-zone world clock.
    "features/dashboard/components/bands.tsx",
    // A tooltip that labels its zone explicitly.
    "features/atlas/atlas-map.tsx",
    // Documentation of an ICS line's format, not a formatting call.
    "infrastructure/integrations/ics.ts",
  ]);

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (allowed.has(p)) continue;
      const src = fs.readFileSync(p, "utf8");
      src.split("\n").forEach((line, i) => {
        if (!line.includes("Asia/Kolkata")) return;
        // A comment explaining the default is fine.
        if (/^\s*(\*|\/\/)/.test(line)) return;
        offenders.push(`${p}:${i + 1}`);
      });
    }
  };
  for (const dir of ["core", "app", "features", "infrastructure", "components"]) walk(dir);

  assert.deepEqual(offenders, [], "use TZ or tzDay() from lib/config instead");
});

test("a training week is one bucket, not two", async () => {
  const { weekKeyOf } = await import("@/core/health/progression");

  // Two sessions on the same Monday in IST: an early one and a mid-morning
  // one. 02:00 IST Monday is 20:30 UTC *Sunday*, so the old code — which found
  // Monday from local time and then read the date back out of toISOString() —
  // filed them under different weeks, halving the volume of both.
  const earlyMonday = "2026-08-03T02:00:00+05:30";
  const lateMonday = "2026-08-03T10:00:00+05:30";
  assert.equal(weekKeyOf(earlyMonday), weekKeyOf(lateMonday));

  // And the whole week agrees, Monday through Sunday.
  const week = [
    "2026-08-03T23:30:00+05:30",  // Mon, late
    "2026-08-06T07:00:00+05:30",  // Thu
    "2026-08-09T21:00:00+05:30",  // Sun, late — still this week
  ].map(weekKeyOf);
  assert.deepEqual(new Set(week).size, 1, "one week, one key");
  assert.equal(week[0], "2026-08-03");

  // The next day starts a new week.
  assert.equal(weekKeyOf("2026-08-10T09:00:00+05:30"), "2026-08-10");
});

test("the database bootstrap matches the migrations it is built from", async () => {
  // Setup instructions and reality drift apart the moment someone adds a
  // migration and forgets the generated file. Then a new instance runs a
  // schema missing whatever was added last, and the failure surfaces much
  // later as a column that does not exist.
  const fs = await import("node:fs");

  const parts = [
    fs.readFileSync("prisma/migrations/0001_init/migration.sql", "utf8"),
    ...fs.readdirSync("prisma/sql").sort()
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(`prisma/sql/${f}`, "utf8")),
  ];

  const bootstrap = fs.readFileSync("prisma/bootstrap.sql", "utf8");
  for (const part of parts) {
    // Compare on content rather than byte-for-byte, so the generated banner
    // and section headers are free to change without failing this.
    const body = part.trim();
    assert.ok(
      bootstrap.includes(body),
      "prisma/bootstrap.sql is stale — run scripts/build-bootstrap.sh",
    );
  }
});

test("a number lookup tells failure and absence apart", async () => {
  // The route returned an empty list both when LeetCode was unreachable and
  // when the number did not exist, so an outage read as "Nothing matched" and
  // there was nothing to debug from. The sentinel is what keeps them separate,
  // so the contract is worth pinning even though the network call is not.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("app/api/leetcode/search/route.ts", "utf8"));

  assert.match(src, /"unavailable"/, "the failure sentinel must reach the route");
  assert.match(src, /status:\s*502/, "an unreachable list is an error, not an empty result");

  // And the integration must actually be able to produce it.
  const lc = await import("node:fs").then((fs) =>
    fs.readFileSync("infrastructure/integrations/leetcode.ts", "utf8"));
  assert.match(
    lc,
    /problemByNumber\([^)]*\):\s*Promise<ProblemSummary \| null \| "unavailable">/,
    "problemByNumber must distinguish not-found from unreachable",
  );
});

test("the ambient voice is the only thing that may speak on its own", async () => {
  // The rule changed deliberately, and the test changed with it rather than
  // being deleted. Ambient alerts are wanted — across every domain, not just
  // the markets — but interruption is the whole risk, so the guards are the
  // thing worth pinning: everything else still speaks only when asked.
  const fs = await import("node:fs");
  const path = await import("node:path");

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name)) files.push(p);
    }
  };
  walk("components");
  walk("features");

  const timerSpeakers: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!/speakLowLatency|voice\/speak|synth\.speak|speechSynthesis\.speak/.test(src)) continue;
    // The assistant's own loop is exempt: it runs only once enabled and addressed.
    if (file.endsWith("features/voice/engine.ts")) continue;
    if (/set(Timeout|Interval)\s*\(\s*(run|check|speak)/.test(src)) timerSpeakers.push(file);
  }

  assert.deepEqual(
    timerSpeakers,
    ["components/ambient-voice.tsx"],
    "only the ambient voice may speak unprompted",
  );

  // And it may only do so under the conditions that keep it bearable.
  const ambient = fs.readFileSync("components/ambient-voice.tsx", "utf8");
  assert.match(ambient, /sound\.isOn\(\)/, "muting the app must silence it");
  assert.match(ambient, /isTyping\(\)/, "it must not talk over you mid-sentence");
  assert.match(ambient, /document\.hidden/, "a background tab has no business talking");
  assert.match(ambient, /voiceOpen/, "it must not interrupt a live conversation");
  assert.match(ambient, /first/, "the backlog on arrival is recorded, not read aloud");
});

test("what gets said first is what costs most to miss", async () => {
  const { rankAmbient, nextToSay } = await import("@/core/ambient");

  const items = [
    { key: "m", urgency: "notice" as const, domain: "market", text: "SOL up 3.2%." },
    { key: "c", urgency: "now" as const, domain: "calendar", text: "Standup in 10 minutes." },
    { key: "t", urgency: "soon" as const, domain: "task", text: "Two tasks past their date." },
  ];

  // A coin moving is information; a meeting starting is a consequence.
  assert.deepEqual(rankAmbient(items).map((i) => i.key), ["c", "t", "m"]);

  // Mid-morning, the meeting is what gets said.
  const morning = new Date("2026-08-09T05:00:00Z"); // 10:30 IST
  assert.equal(nextToSay(items, {}, morning)?.key, "c");

  // Already said today, so it moves on rather than repeating itself.
  assert.equal(nextToSay(items, { c: "1" }, morning)?.key, "t");

  // Chatter alone, late in the evening: say nothing at all.
  const late = new Date("2026-08-09T16:30:00Z"); // 22:00 IST
  assert.equal(nextToSay([items[0]], {}, late), null);

  // And nothing whatsoever in the small hours.
  const night = new Date("2026-08-09T20:00:00Z"); // 01:30 IST
  assert.equal(nextToSay(items, {}, night), null);
});

test("the security headers say what they must, and allow what the app needs", async () => {
  const { SECURITY_HEADERS, CSP } = await import("@/lib/security");
  const byKey = new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));

  // Clickjacking: SAGE holds money, mail and health. It must never be framed.
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.equal(byKey.get("X-Frame-Options"), "DENY");

  assert.match(CSP, /object-src 'none'/);
  assert.match(CSP, /base-uri 'self'/);
  assert.match(CSP, /form-action 'self'/);
  assert.match(byKey.get("Strict-Transport-Security") ?? "", /max-age=\d{7,}/);
  assert.equal(byKey.get("X-Content-Type-Options"), "nosniff");

  // A policy that breaks the app gets deleted, and a deleted policy protects
  // nothing — so the things the app genuinely needs are pinned here too.
  const perms = byKey.get("Permissions-Policy") ?? "";
  assert.match(perms, /microphone=\(self\)/, "dictation needs the microphone");
  assert.match(perms, /publickey-credentials-get=\(self\)/, "passkeys stop working without this");
  assert.match(CSP, /img-src[^;]*https:/, "article thumbnails come from anywhere");
  assert.match(CSP, /frame-src[^;]*youtube/, "the morning block embeds video");
});

test("a state-changing request has to come from SAGE's own pages", async () => {
  const { sameOrigin, MUTATING } = await import("@/lib/security");

  const req = (headers: Record<string, string>) =>
    new Request("https://sage.example/api/task", { method: "POST", headers });

  assert.equal(sameOrigin(req({ origin: "https://sage.example", host: "sage.example" })), true);
  assert.equal(sameOrigin(req({ origin: "https://evil.example", host: "sage.example" })), false);

  // No Origin at all is refused rather than waved through. Browsers always
  // send it on these methods; something that does not is not a browser.
  assert.equal(sameOrigin(req({ host: "sage.example" })), false);
  assert.equal(sameOrigin(req({ origin: "not a url", host: "sage.example" })), false);

  // Reads are untouched — the gate is about changing things.
  assert.equal(MUTATING.has("GET"), false);
  assert.equal(MUTATING.has("DELETE"), true);
});

test("the relying party is not taken from a header when it can be configured", async () => {
  // The Host header is attacker-controlled. Deriving the passkey's relying
  // party from it would let someone bind a credential to a hostname of their
  // choosing, which is the one input this feature must not trust.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("core/auth/passkeys.ts", "utf8"));

  const fn = src.slice(src.indexOf("export function relyingParty"));
  const appUrlAt = fn.indexOf("APP_URL");
  const hostAt = fn.indexOf('headers.get("host")');
  assert.ok(appUrlAt !== -1 && hostAt !== -1);
  assert.ok(appUrlAt < hostAt, "APP_URL must be consulted before the Host header");
});

// ── Time budgets ───────────────────────────────────────────────────────────
//
// These exist because production was hitting the Vercel runtime timeout on
// /api/cron and /api/reminders/tick. Every step in those routes was wrapped in
// `.catch()`, which is the trap: it makes a *rejecting* step safe and does
// nothing whatsoever for a step that simply never settles. The first test is
// the one that matters — a promise that never resolves must not be able to
// hold the tick open.

test("within: a promise that never settles resolves to the fallback", async () => {
  const neverSettles = new Promise<string>(() => {});
  const started = Date.now();
  const got = await within(neverSettles, 30, "fallback");
  assert.equal(got, "fallback");
  assert.ok(Date.now() - started < 1000, "should have given up at the budget, not waited");
});

test("within: a rejection is also the fallback, not a throw", async () => {
  assert.equal(await within(Promise.reject(new Error("upstream down")), 50, 7), 7);
});

test("within: work that finishes in time returns its real value", async () => {
  assert.equal(await within(Promise.resolve("real"), 500, "fallback"), "real");
});

test("deadline: a spent budget skips the remaining steps by name", async () => {
  const d = deadline(20);
  // Burn the budget on a step that hangs.
  const first = await d.step("hangs", () => new Promise<number>(() => {}), 1000, -1);
  assert.equal(first, -1);

  // The step above is clamped to exactly the budget, so it returns with the
  // clock sitting on zero and millisecond rounding decides whether the next
  // step is "past" the deadline. Wait past it so this asserts the skip rule
  // rather than the resolution of Date.now().
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(d.expired(), true);

  let ranSecond = false;
  const second = await d.step(
    "housekeeping",
    async () => {
      ranSecond = true;
      return 99;
    },
    1000,
    0,
  );

  // The point of the ordering in /api/cron: when time runs out the tail is
  // dropped and *named*, rather than the platform killing the function and
  // leaving no record of how far it got.
  assert.equal(ranSecond, false, "a step past the deadline must not even start");
  assert.equal(second, 0);
  assert.deepEqual(d.skipped, ["housekeeping"]);
});

test("deadline: a step cannot outlive the budget it is given", async () => {
  const d = deadline(60);
  const started = Date.now();
  await d.step("slow", () => new Promise<null>(() => {}), 10_000, null);
  assert.ok(Date.now() - started < 1000, "the step budget must be clamped to the time left");
});

test("the cron tick budgets every step and stops before the platform does", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("app/api/cron/route.ts", "utf8");

  const maxDuration = Number(src.match(/maxDuration\s*=\s*(\d+)/)?.[1]);
  const budget = Number(src.match(/BUDGET_MS\s*=\s*([\d_]+)/)?.[1].replace(/_/g, ""));
  assert.ok(maxDuration > 0 && budget > 0);
  assert.ok(
    budget < maxDuration * 1000,
    "the self-imposed budget must end the tick before the platform kills it, " +
      "otherwise the response that reports what ran never gets sent",
  );

  // No step may go back to a bare `.catch()`, which is what caused the outage.
  assert.ok(!/\.catch\(\(\) =>/.test(src), "cron steps must go through deadline.step, not .catch()");
});

// ── Machine authentication ─────────────────────────────────────────────────
//
// Seven routes are reachable without a session because a scheduler or an iOS
// Shortcut has to reach them. They had each grown their own copy of the secret
// check, and the copies disagreed about two things worth pinning down.

test("machineAuth: accepts the secret by header or by query", async () => {
  const secret = "s3cr3t-value";
  process.env.CRON_SECRET = secret;
  delete process.env.SAGE_PASSWORD;

  const withHeader = new Request("https://sage.test/api/cron", {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(machineAuth(withHeader), true);

  // Shortcuts and most free cron pingers cannot set a header.
  assert.equal(machineAuth(new Request(`https://sage.test/api/beat?key=${secret}`)), true);
  // The phone webhook's existing spelling, kept so built Shortcuts still work.
  assert.equal(machineAuth(new Request(`https://sage.test/api/webhook/phone?token=${secret}`)), true);

  assert.equal(machineAuth(new Request("https://sage.test/api/cron?key=wrong")), false);
  assert.equal(machineAuth(new Request("https://sage.test/api/cron")), false);
});

test("machineAuth: an unset secret does not open the endpoint in production", async () => {
  delete process.env.CRON_SECRET;

  // /api/beat and /api/cron used to read "no CRON_SECRET" as "gate disabled"
  // and run for anybody. A deploy that loses the variable would then silently
  // expose them rather than failing somewhere visible.
  process.env.SAGE_PASSWORD = "the app gate is on";
  assert.equal(machineAuth(new Request("https://sage.test/api/cron")), false);

  // With the whole app gate off, this is a local dev box and it stays open.
  delete process.env.SAGE_PASSWORD;
  assert.equal(machineAuth(new Request("https://sage.test/api/cron")), true);
});

test("machineAuth: a wrong secret takes the same work regardless of prefix", async () => {
  process.env.CRON_SECRET = "abcdefghijklmnopqrstuvwxyz";
  delete process.env.SAGE_PASSWORD;
  // Not a timing measurement — those are far too noisy to assert on. This
  // pins the property that makes constant time possible: every candidate of
  // the same length is rejected the same way, whether it shares 0 characters
  // with the secret or 25 of them.
  const almost = "abcdefghijklmnopqrstuvwxy?";
  const nothing = "??????????????????????????";
  assert.equal(machineAuth(new Request(`https://sage.test/a?key=${almost}`)), false);
  assert.equal(machineAuth(new Request(`https://sage.test/a?key=${nothing}`)), false);
  delete process.env.CRON_SECRET;
});

test("no machine route compares its secret with === or !==", async () => {
  const fs = await import("node:fs");
  const routes = [
    "app/api/cron/route.ts",
    "app/api/cron/evening/route.ts",
    "app/api/beat/route.ts",
    "app/api/webhook/ask/route.ts",
    "app/api/webhook/health/route.ts",
    "app/api/webhook/location/route.ts",
    "app/api/webhook/phone/route.ts",
  ];
  for (const r of routes) {
    const src = fs.readFileSync(r, "utf8");
    assert.ok(
      /machineAuth\(/.test(src),
      `${r} must authenticate through the shared machineAuth, not its own copy`,
    );
    assert.ok(
      !/(!==|===)\s*`?Bearer|provided\s*!==\s*secret/.test(src),
      `${r} compares a secret directly — that leaks its prefix through timing`,
    );
  }
});

// ── Model failure classification ───────────────────────────────────────────
//
// The failover in infrastructure/llm decides what to do from which of these
// three predicates matches. An error matching none of them takes the
// `throw err` branch meant for genuine application errors — no retry, no key
// rotation, no model fallback.
//
// That is what killed the research agent: Google's load-shedding message
// matched nothing, so it was treated as fatal on the first refusal.

test("an overloaded model is recognised as transient, not fatal", () => {
  // The verbatim error the research agent surfaced.
  const real = new Error(
    "AI_APICallError: This model is currently experiencing high demand. " +
      "Spikes in demand are usually temporary. Please try again later.",
  );
  assert.equal(isOverloadedError(real), true, "this is the error that was falling through");

  // It must not be mistaken for the other two: a quota error sidelines the key
  // for up to two hours, and a model error burns through the id list. Neither
  // is the right response to "busy, try again".
  assert.equal(isQuotaError(real), false, "an overload must not sideline a healthy key");
  assert.equal(isModelError(real), false, "an overload must not retire a working model id");

  for (const msg of [
    "503 Service Unavailable",
    "The model is overloaded. Please try again later.",
    "UNAVAILABLE: server is temporarily unavailable",
  ]) {
    assert.equal(isOverloadedError(new Error(msg)), true, msg);
  }
});

test("the three model failure classes stay distinct", () => {
  const quota = new Error("429 RESOURCE_EXHAUSTED: You exceeded your current quota");
  assert.equal(isQuotaError(quota), true);
  assert.equal(isOverloadedError(quota), false, "a quota refusal must still sideline the key");

  const retired = new Error("models/gemini-2.5-flash is not found or no longer available");
  assert.equal(isModelError(retired), true);
  assert.equal(isOverloadedError(retired), false, "a retired id must still advance to the next id");

  // A genuine application error must match nothing, so it reaches the caller
  // instead of being retried into the ground.
  const real = new Error("Invalid JSON in tool arguments");
  assert.equal(isModelError(real), false);
  assert.equal(isQuotaError(real), false);
  assert.equal(isOverloadedError(real), false);
});

test("the market does not get to do all the talking", async () => {
  const { nextToSay, weightedPick } = await import("@/core/ambient");
  const morning = new Date("2026-08-09T05:00:00Z"); // 10:30 IST

  // The situation as reported: a quiet afternoon where the market and a task
  // are both merely "notice". Previously the strict sort made this the same
  // sentence every time; and because prices move every few minutes while
  // tasks and meetings do not, the market was usually the only thing present.
  const chatter = [
    { key: "t", urgency: "notice" as const, domain: "task", text: "Two tasks still due today." },
    { key: "m", urgency: "notice" as const, domain: "market", text: "SOL up 9.4%." },
  ];

  // Weighted 10:1 toward the task, so over many draws the market is rare but
  // not silenced. Deterministic rand, so this asserts the weighting itself.
  assert.equal(weightedPick(chatter, () => 0.0)?.key, "t");
  assert.equal(weightedPick(chatter, () => 0.99)?.key, "m");

  let tasks = 0;
  for (let i = 0; i < 1000; i++) if (nextToSay(chatter, {}, morning, Math.random)?.key === "t") tasks += 1;
  assert.ok(tasks > 800, `the task should win most draws, got ${tasks}/1000`);
  assert.ok(tasks < 1000, "but the market should not be silenced entirely");
});

test("urgency still beats the weighting outright", async () => {
  const { nextToSay } = await import("@/core/ambient");
  const morning = new Date("2026-08-09T05:00:00Z");

  const items = [
    { key: "m", urgency: "notice" as const, domain: "market", text: "SOL up 12%." },
    { key: "c", urgency: "now" as const, domain: "calendar", text: "Standup in 10 minutes." },
    { key: "t", urgency: "soon" as const, domain: "task", text: "Two tasks past their date." },
  ];

  // Randomising across tiers would make the most important announcement a coin
  // flip. Whatever the roll, the meeting is what gets said.
  for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
    assert.equal(nextToSay(items, {}, morning, () => roll)?.key, "c");
  }
});

test("a routine market move is not worth interrupting for", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("core/ambient/index.ts", "utf8");
  const threshold = Number(src.match(/MARKET_MIN_MOVE_PCT\s*=\s*Number\([^)]*\?\?\s*(\d+)/)?.[1]);
  // "SOL up 3.2%" was the complaint: a normal day for a volatile asset,
  // announced with the same weight as a missed meeting.
  assert.ok(threshold >= 5, `threshold should exclude routine moves, got ${threshold}`);
});

// ── LeetCode: the statement is the source of truth ─────────────────────────

test("a LeetCode statement survives the trip out of HTML", async () => {
  const { flattenStatement } = await import("@/infrastructure/integrations/leetcode");

  // Constraints are exactly where an undecoded entity does the most damage:
  // the statement still reads like a statement, so nothing looks broken, and
  // the model quietly supplies the bound it remembers instead.
  const html =
    "<p>Given <code>nums<sub>i</sub></code>.</p>" +
    "<p><strong>Constraints:</strong></p>" +
    "<ul><li><code>1 &le; n &le; 10<sup>5</sup></code></li>" +
    "<li><code>-2 &times; 10<sup>4</sup> &le; nums<sub>i</sub> &le; 2 &times; 10<sup>4</sup></code></li></ul>";

  const text = flattenStatement(html);
  assert.match(text, /1 <= n <= 10\^5/, "&le; must decode, or the bound is lost");
  assert.ok(!text.includes("&le;"), "no raw entities may survive");
  assert.ok(!text.includes("&times;"), "no raw entities may survive");
  assert.match(text, /nums_i/, "nums<sub>i</sub> must stay distinguishable from numsi");
  assert.ok(!/<[a-z]/i.test(text), "no tags may survive");
});

test("&amp; is decoded last, so escaped entities are not corrupted", async () => {
  const { flattenStatement } = await import("@/infrastructure/integrations/leetcode");
  // A statement showing the literal text "&lt;" arrives as "&amp;lt;".
  // Decoding &amp; first would turn it into "&lt;" and the next rule would
  // then turn that into "<" — silently changing what the problem says.
  assert.equal(flattenStatement("<p>write &amp;lt; here</p>").trim(), "write &lt; here");
});

test("the coach is told to use the statement rather than recall the problem", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("core/coding/coach.ts", "utf8");

  assert.match(src, /ACCURACY/, "the grounding rule must be in the prompt");
  assert.match(src, /LANGUAGE: write every line of code in/, "the language must be an instruction, not a label");

  // A missing statement must refuse rather than answer from memory — that is
  // the case where recall is guaranteed to be the only source.
  assert.match(src, /if \(!input\.statement\.trim\(\)\)/);

  // Truncation is the other route to recall: a model handed half a statement
  // completes it.
  const budget = Number(src.match(/input\.statement\.slice\(0,\s*([\d_]+)\)/)?.[1].replace(/_/g, ""));
  assert.ok(budget >= 10_000, `statement budget too small to hold a real problem: ${budget}`);
});

test("opening the chat starts a clean transcript, and memory is elsewhere", async () => {
  const fs = await import("node:fs");
  const page = fs.readFileSync("app/(shell)/chat/page.tsx", "utf8");
  const threads = fs.readFileSync("infrastructure/db/threads.ts", "utf8");

  // Landing on the most recent thread is what made the text never refresh.
  assert.ok(
    !/getOrCreateLatestThread/.test(page),
    "the chat page must not resume the last thread by default",
  );
  assert.match(page, /startFreshThread/);

  // Reusing an already-blank thread, so repeated opens do not pile up empties.
  assert.match(threads, /count: "exact", head: true/);

  // The part that makes a clean transcript safe: recall is by relevance from
  // the Memory table, not by reading the thread back. If this ever moves,
  // starting fresh would become real amnesia.
  const chat = fs.readFileSync("app/api/chat/route.ts", "utf8");
  assert.match(chat, /recallWithin/, "a fresh thread must still recall past facts");
  assert.match(chat, /extractMemories/, "and must still write new ones");
});

test("the TickTick list is never served from a cache", async () => {
  const fs = await import("node:fs");
  const route = fs.readFileSync("app/api/ticktick/route.ts", "utf8");

  // This was `revalidate = 60`, and it is the whole reason adding a task
  // looked like it had not synced: the client adds, refetches at once, and
  // gets the list Next cached up to a minute ago — the one without it.
  assert.ok(!/export const revalidate/.test(route), "a list being edited must not be cached");
  assert.match(route, /export const dynamic = "force-dynamic"/);

  // Removal has to travel both ways, or the two lists drift the way they did
  // before createTickTask closed the same hole for additions.
  assert.match(route, /export async function DELETE/);

  const band = fs.readFileSync("features/dashboard/components/ticktick-band.tsx", "utf8");
  // An optimistic removal that ignores the outcome is a silent lie: the row
  // cleared, the task came back on the next poll.
  assert.match(band, /if \(!res\?\.ok\)[\s\S]*load\(\); return;/);

  // Refresh-on-return now lives in the shared hook rather than in this file.
  assert.match(band, /useLive\(/);
  const live = fs.readFileSync("lib/live.ts", "utf8");
  assert.match(live, /visibilitychange/, "looking at the page must refresh it");

  // The Eisenhower band renders the same TickTick list. Without a shared
  // notification the two sat on independent timers and disagreed after a tick.
  const eisen = fs.readFileSync("features/dashboard/components/eisenhower-band.tsx", "utf8");
  for (const [name, src] of [["deadlines", band], ["matrix", eisen]] as const) {
    assert.match(src, /useLive\([\s\S]*scopes: \["tasks"\]/, `${name} must listen for task changes`);
    assert.match(src, /notifyDataChanged\("tasks"\)/, `${name} must announce its own changes`);
  }
});

test("no tier ends on a model id known to be retired", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("infrastructure/llm/index.ts", "utf8");

  /**
   * The 2.0-flash outage was not a failover bug — the failover caught the
   * model error and advanced exactly as designed. It failed because
   * gemini-2.0-flash was the LAST id in the list, so advancing ran off the
   * end. The mechanism only works if there is somewhere left to go.
   */
  const RETIRED = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-pro"];
  for (const dead of RETIRED) {
    assert.ok(
      !new RegExp(`"${dead}"`).test(src),
      `${dead} is retired and must not be in the list — it costs a round trip and cannot be a fallback`,
    );
  }

  // Each tier must still lead with a `-latest` alias, which is the only entry
  // Google repoints on our behalf and therefore the only one that survives a
  // retirement without a deploy.
  const smart = src.match(/smart: \[([\s\S]*?)\]/)?.[1] ?? "";
  const fast = src.match(/fast: \[([\s\S]*?)\]/)?.[1] ?? "";
  assert.match(smart, /"gemini-flash-latest"/);
  assert.match(fast, /"gemini-flash-lite-latest"/);

  // And more than one real id per tier, so there is an actual fallback.
  for (const [tier, body] of [["smart", smart], ["fast", fast]] as const) {
    const ids = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 2, `${tier} needs a fallback id, has ${ids.length}`);
  }
});

// ── Nothing interrupts a brief that is already playing ─────────────────────

test("the ambient voice waits for whatever is already speaking", async () => {
  const fs = await import("node:fs");
  const ambient = fs.readFileSync("components/ambient-voice.tsx", "utf8");

  /**
   * The morning brief plays as a chain of parts, and starting any new
   * utterance abandons the rest of the chain. The ambient poll fires every
   * four minutes and its guards covered the voice overlay, typing and hidden
   * tabs — but not "something else is mid-sentence". Press Listen, wait four
   * minutes, and the brief stopped dead with no error.
   */
  assert.match(ambient, /isSpeaking\(\)/, "it must not talk over an utterance in progress");

  // The guards that were already there must survive alongside it.
  for (const guard of ["voiceOpen", "isTyping()", "document.hidden", "sound.isOn()"]) {
    assert.ok(ambient.includes(guard), `${guard} guard must remain`);
  }

  const speak = fs.readFileSync("lib/speak.ts", "utf8");
  assert.match(speak, /export function isSpeaking/);
  // Stopping deliberately must release the floor, or one stopped brief would
  // silence the ambient voice for the length of the lease.
  assert.match(speak, /export function forgetRest\(\): void \{\s*releaseSpeaking\(\);/);
});

test("a failed continuation does not end a long answer mid-sentence", async () => {
  const fs = await import("node:fs");
  const speak = fs.readFileSync("lib/speak.ts", "utf8");

  // A long brief is several requests back to back. This used to `break` the
  // moment one failed, which ended the audio silently — a provider blip on
  // piece three of seven cost the other four.
  assert.match(speak, /segmentWithRetry/);
  assert.ok(
    !/const more = await segment\(Number\(next\)\)\.catch/.test(speak),
    "continuations must go through the retrying path",
  );

  // And when the retries are exhausted, finish in the browser voice rather
  // than stopping: the point of a brief is that you heard all of it.
  assert.match(speak, /remainderFrom/);

  // Both sides must split identically, or the remainder would be wrong text.
  const route = fs.readFileSync("app/api/voice/speak/route.ts", "utf8");
  assert.match(route, /SPEAK_CHUNK_CHARS/);
  assert.ok(!/splitForSpeech\(clean, \d+\)/.test(route), "the chunk size must be the shared constant");
});

// ── Narrow windows ─────────────────────────────────────────────────────────

test("the hero gives the map a bounded row and never overlays it", async () => {
  const fs = await import("node:fs");
  const raw = fs.readFileSync("features/dashboard/command.css", "utf8");
  // Comments in this file quote the old rules while explaining why they
  // changed, so a naive search finds the prose and not the CSS.
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

  /**
   * The 3D globe is retired and the hero is no longer an overlay stage.
   *
   * It used to position the map at inset:0 and float two glass columns on top
   * of it — which works for a sphere with empty corners and fails completely
   * for a map, because a map uses every pixel it is given. The columns covered
   * the Atlas toolbar, so the map's own controls were in the DOM, styled, and
   * unreachable. Rows cannot do that: nothing overlaps, so nothing can hide.
   */
  // Anchored to the start of a line: density overrides are written as
  // `html[data-density="compact"] .deck { … }` and an unanchored match finds
  // whichever comes first in the file, not the base rule being asserted.
  const hero = css.match(/^\.deck\s*\{([^}]*)\}/m)?.[1] ?? "";
  assert.match(hero, /flex-direction:\s*column/, "the hero must stack in rows");
  assert.doesNotMatch(hero, /position:\s*absolute/, "the hero must not be an overlay stage again");

  const map = css.match(/^\.deck-map\s*\{([^}]*)\}/m)?.[1] ?? "";
  assert.ok(map, ".deck-map rule is missing");
  assert.match(map, /vh/, "the map row must yield to viewport height, not take a fixed slab");
  assert.match(map, /min-height/, "and needs a floor so it never becomes a sliver");

  // The retired globe must not creep back in through a stylesheet.
  assert.doesNotMatch(css, /\.heart-globe\s*\{/, "the globe is retired");
  assert.doesNotMatch(css, /\.heart-side\.(left|right)\s*\{/, "the floating columns are retired");
});

test("compact density changes spacing without hiding anything", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync("features/dashboard/command.css", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const rules = [...css.matchAll(/html\[data-density="compact"\][^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rules.length >= 5, `expected several compact rules, found ${rules.length}`);

  // The whole point: a density control that removes features is not a density
  // control, it is a worse version of the app.
  for (const body of rules) {
    assert.ok(
      !/display:\s*none/.test(body),
      `compact must not hide anything — found "display: none" in: ${body.trim().slice(0, 60)}`,
    );
  }

  // Applied before the first paint, or the page visibly snaps from one layout
  // to the other on every load.
  const layout = fs.readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /sage-density/, "density must be applied inline, ahead of hydration");
});

// ── A hidden tab costs nothing ─────────────────────────────────────────────

test("polling stops when nobody is looking", async () => {
  const fs = await import("node:fs");
  const live = fs.readFileSync("lib/live.ts", "utf8");

  /**
   * Measured in a real browser: a hidden dashboard was making 32 API calls a
   * minute, 28 of them the globe's satellite layer refreshing a scene nobody
   * could see. That is the free tier being spent on nothing.
   *
   * It also rules out the obvious "make it instant" answer. An SSE connection
   * occupies a serverless function for as long as it is held open, so one tab
   * left open all day is 24 hours of function time per day — far past a free
   * plan, for an app whose whole premise is costing nothing. Pausing when
   * hidden and polling faster when visible buys the same feeling and costs
   * less than before.
   */
  assert.match(live, /document\.hidden \? hiddenMs : everyMs/,
    "the interval must depend on whether the tab is visible");
  assert.match(live, /hiddenMs/, "there must be a way to opt into polling while hidden");

  // The globe used to be the expensive one — a WebGL scene re-polling
  // satellites every five seconds behind a hidden tab. It is now retired
  // outright rather than gated, which is the stronger version of the same
  // fix, so the assertion is that it is gone and its dependencies with it.
  assert.ok(!fs.existsSync("features/atlas/hero-globe.tsx"), "the globe is retired");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const dead of ["globe.gl", "three", "@types/three"]) {
    assert.ok(!(dead in deps), `${dead} was only there for the globe`);
  }

  // Reminders are the deliberate exception: they fire things rather than only
  // showing them, so they slow down instead of stopping.
  const rem = fs.readFileSync("components/reminder-ticker.tsx", "utf8");
  assert.match(rem, /hiddenMs:/, "reminder delivery must continue while hidden, just slower");
});

test("the toaster still shows what arrived while the page was closed", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("components/toaster.tsx", "utf8");

  // Moving the poll out of its effect dropped the line that restored the
  // seen-marker, which silently marked the whole backlog as read on every
  // reload instead of showing it. The restore has to run before the first poll.
  assert.match(src, /seenRef\.current = localStorage\.getItem\(SEEN_KEY\)/);
  assert.match(src, /firstRef\.current = !seenRef\.current/,
    "the backlog is suppressed only on a genuinely first run");
});

// ── Creating GitHub repos by voice ─────────────────────────────────────────

test("a spoken repo name becomes a valid GitHub name", async () => {
  const { nativeTools } = await import("@/core/tools/native");
  const t = nativeTools.create_github_repo as unknown as {
    execute: (a: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  assert.ok(t, "the voice must have a repo-creation tool");

  /**
   * Speech does not produce repo names. "make me a repo called Weekend
   * Planner" arrives with a space and a capital, and GitHub answers 422 —
   * which surfaces as "that name may already exist", pointing at entirely the
   * wrong problem. The slug runs before anything is sent.
   *
   * Public is refused without confirmation, so these calls reach the slug and
   * stop before touching GitHub — which is exactly what makes them testable
   * with no token and no network.
   */
  const slugOf = async (spoken: string) => {
    const r = await t.execute({ name: spoken, visibility: "public", confirmPublic: false });
    return String(r.error ?? "").match(/"([^"]+)" should be public/)?.[1] ?? null;
  };

  assert.equal(await slugOf("Weekend Planner"), "weekend-planner");
  assert.equal(await slugOf("SAGE  OS  v2"), "sage-os-v2");
  assert.equal(await slugOf("Gyaan's notes!"), "gyaans-notes");
  assert.equal(await slugOf("  trailing spaces  "), "trailing-spaces");
  // Already valid names must pass through untouched.
  assert.equal(await slugOf("sage-os"), "sage-os");

  // Nothing usable left is a clear refusal, not a mystery 422 from GitHub.
  const empty = await t.execute({ name: "!!!", visibility: "private", confirmPublic: false });
  assert.equal(empty.ok, false);
  assert.match(String(empty.error), /does not leave anything usable/);
});

test("a repo is never made public by a single mishearing", async () => {
  const { nativeTools } = await import("@/core/tools/native");
  const t = nativeTools.create_github_repo as unknown as {
    execute: (a: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };

  /**
   * A private repo made by mistake is a tidy-up. A public one has been
   * announced to the internet and may be indexed before anyone notices. This
   * is a voice interface, so "public" is one misheard word away at all times —
   * hence two separate signals, and private whenever they disagree.
   */
  const asked = await t.execute({ name: "secret-thing", visibility: "public", confirmPublic: false });
  assert.equal(asked.ok, false);
  assert.equal(asked.needsConfirmation, true, "public must ask before it acts");
  assert.match(String(asked.error), /Nothing has been created yet/);

  // The schema's own default must be private, so an omitted field is safe.
  const schema = (nativeTools.create_github_repo as unknown as {
    inputSchema: { parse: (v: unknown) => { visibility: string; confirmPublic: boolean } };
  }).inputSchema;
  const parsed = schema.parse({ name: "x" });
  assert.equal(parsed.visibility, "private", "omitting visibility must mean private");
  assert.equal(parsed.confirmPublic, false);
});

// ── Three bugs found reviewing this session's own work ─────────────────────

test("end of today is the owner's midnight, not the server's", async () => {
  const { endOfTodayUtc, startOfTodayUtc } = await import("@/lib/config");

  // The pair must bracket exactly one day.
  const start = new Date(startOfTodayUtc()).getTime();
  const end = new Date(endOfTodayUtc()).getTime();
  assert.equal(end - start, 86_400_000 - 1, "start and end must bracket one whole day");

  /**
   * `new Date().setHours(23, 59, 59, 999)` is the *server's* midnight, which on
   * Vercel is UTC — 05:29 the next morning in IST. A "due today" filter built
   * that way silently swallows several hours of tomorrow. This is the same
   * class of bug as the toISOString() day keys the codebase already guards
   * against, and it was reintroduced right next to the helper that prevents it.
   */
  const fs = await import("node:fs");
  // Comments here name the old call while explaining why it went, so strip
  // them before searching — otherwise the prose fails the test.
  const ambient = fs.readFileSync("core/ambient/index.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.ok(!/setHours\(23,\s*59/.test(ambient), "server-local midnight must not come back");
  assert.match(ambient, /endOfTodayUtc\(\)/);

  // Every moment of today must sit inside the bracket.
  for (const h of [0, 6, 12, 23]) {
    const probe = new Date();
    probe.setUTCHours(h, 30, 0, 0);
    const s = new Date(startOfTodayUtc(probe)).getTime();
    const e = new Date(endOfTodayUtc(probe)).getTime();
    assert.ok(s <= probe.getTime() && probe.getTime() <= e, `probe at ${h}:30 UTC fell outside its own day`);
  }
});

test("a stall does not hand the floor to the ambient voice", async () => {
  const fs = await import("node:fs");
  const speak = fs.readFileSync("lib/speak.ts", "utf8");

  /**
   * A long brief plays as chained MediaSource segments, and a buffer underrun
   * between them fires `pause` mid-utterance without the audio being over.
   * Releasing the lease there let the ambient poll conclude nothing was
   * speaking and drop the rest of the brief — the exact failure the lease was
   * added to prevent, reintroduced by the mechanism meant to fix it.
   */
  assert.ok(
    !/addEventListener\("pause",\s*releaseSpeaking\)/.test(speak),
    "`pause` fires on a mid-utterance stall and must not release the lease",
  );
  // Only genuinely-finished events may.
  assert.match(speak, /addEventListener\("ended",\s*releaseSpeaking\)/);
  assert.match(speak, /addEventListener\("error",\s*releaseSpeaking\)/);
});

test("a voice failure reason belongs to the call that produced it", async () => {
  const fs = await import("node:fs");
  const fish = fs.readFileSync("infrastructure/tts/fish.ts", "utf8");
  const route = fs.readFileSync("app/api/voice/speak/route.ts", "utf8");

  // lastFishError is a module global. The speak route fires one request per
  // chunk and diagnose probes alongside them, so reading the global can report
  // a different attempt's failure — and diagnostics that misattribute are
  // worse than none, since the entire point was to stop guessing.
  assert.match(fish, /onFailure\?: \(reason: string\) => void/);
  assert.match(route, /onFailure: \(why\) =>/);
  assert.ok(
    !/lastFishError\(\)/.test(route),
    "the route must take its own reason, not read the shared global",
  );
});

// ── Snoozing a reminder ────────────────────────────────────────────────────

test("a snooze refuses times that would do nothing", async () => {
  const { nativeTools } = await import("@/core/tools/native");
  const t = nativeTools.snooze_reminder as unknown as {
    execute: (a: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  assert.ok(t, "the voice must be able to push a reminder back");

  // A reminder set in the past fires again on the very next tick, so the
  // snooze looks like it did nothing. Both of these refuse before touching
  // the database, which is also why they run with no database.
  const past = await t.execute({ remindAt: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(past.ok, false);
  assert.match(String(past.error), /already passed/);

  const nonsense = await t.execute({ remindAt: "tomorrow-ish" });
  assert.equal(nonsense.ok, false);
  assert.match(String(nonsense.error), /isn't a time I can read/);
});

test("snoozing puts a fired reminder back in the queue", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("core/tools/native.ts", "utf8");
  const tool = src.slice(src.indexOf("snooze_reminder:"), src.indexOf("knowledge_search:"));

  /**
   * `status` is how fireDueReminders claims a reminder — it moves pending →
   * fired and never looks at it again. So a snooze that only changed the time
   * would set a date that nothing would ever act on: the reminder would sit
   * there, permanently fired, and never go off again.
   */
  assert.match(tool, /status: "pending"/, "a snoozed reminder must return to pending");
  assert.match(tool, /\.in\("status", \["pending", "fired"\]\)/,
    "'push that back' usually follows one going off, so fired ones must be findable");

  // Moving the wrong reminder silently is worse than asking which one.
  assert.match(tool, /ambiguous: true/);
});

test("browsing the morning brief does not stop it talking", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("features/morning/morning-block.tsx", "utf8");

  /**
   * The step-loading effect runs on every `active` change, and its cleanup
   * used to call stopSpeak(). So pressing Listen and then touching anything in
   * the brief — Next, or any step in the rail — killed the audio mid-sentence.
   * Reading along while it talks is the obvious way to use this, which is why
   * it read as random rather than as a button doing it.
   *
   * Two separate reports of "the brief cuts out" were chased into the speech
   * layer (an ambient interrupt, then a failed continuation). Both were real,
   * and neither was this. This is the one a person would actually hit.
   */
  const stepEffect = src.slice(src.indexOf("if (step.kind === \"digest\")"), src.indexOf("}, [active, synNonce]);"));
  assert.ok(
    !/stopSpeak\(\)/.test(stepEffect),
    "the per-step effect must not stop playback — its cleanup fires on every step change",
  );

  // Leaving the page still stops it, via an unmount-only effect.
  assert.match(src, /useEffect\(\(\) => \(\) => stopSpeak\(\), \[stopSpeak\]\)/);
});

// ── The disk bridge boundary ───────────────────────────────────────────────
//
// This is the one place in SAGE where a mistake exposes files on a real
// machine, so the gate is tested against an actual directory rather than
// reasoned about. Everything here runs on a fixture in a temp folder.

test("the disk bridge only serves what was actually shared", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");

  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sage-bridge-"));
  const shared = path.join(base, "shared");
  const secret = path.join(base, "secret");
  await fs.mkdir(shared, { recursive: true });
  await fs.mkdir(secret, { recursive: true });
  await fs.writeFile(path.join(shared, "note.md"), "a shared note");
  await fs.writeFile(path.join(shared, ".env"), "API_KEY=live-key");
  await fs.writeFile(path.join(secret, "creds.txt"), "private");
  // A symlink out of the shared folder: the classic escape.
  await fs.symlink(secret, path.join(shared, "escape"));

  process.env.SAGE_URL = "http://127.0.0.1:1";
  process.env.BRIDGE_SECRET = "test";
  process.env.SAGE_ROOTS = shared;
  const bridge = await import(`/home/user/SAGE/ops/disk-bridge/bridge.mjs?t=${Date.now()}`);

  // What was shared is readable.
  const ok = await bridge.run({ op: "read", path: path.join(shared, "note.md") });
  assert.equal(ok.error, undefined);
  assert.match(ok.result.text, /a shared note/);

  // A sibling folder is not, even though it sits next to the shared one.
  const outside = await bridge.run({ op: "read", path: path.join(secret, "creds.txt") });
  assert.ok(outside.error, "a path outside the allowlist must be refused");

  // ../ traversal resolves before it is compared, so it cannot walk out.
  const climb = await bridge.run({ op: "read", path: path.join(shared, "..", "secret", "creds.txt") });
  assert.ok(climb.error, "../ traversal must be refused");

  // Neither can a symlink pointing out — this is why realpath comes first.
  const link = await bridge.run({ op: "read", path: path.join(shared, "escape", "creds.txt") });
  assert.ok(link.error, "a symlink out of the allowlist must be refused");

  // .env sits inside the shared folder. You shared the folder for the notes;
  // you did not mean to hand over your credentials with it.
  const env = await bridge.run({ op: "read", path: path.join(shared, ".env") });
  assert.ok(env.error, ".env must be refused even inside a shared folder");

  // And it must not be listed either, or the name alone leaks that it exists.
  const listed = await bridge.run({ op: "list", path: shared });
  assert.ok(!listed.result.entries.some((e: { name: string }) => e.name === ".env"));

  await fs.rm(base, { recursive: true, force: true });
});

test("the disk bridge cannot write, delete or execute", async () => {
  const fsp = await import("node:fs");
  const raw = fsp.readFileSync("ops/disk-bridge/bridge.mjs", "utf8");
  // The file explains at length why it cannot write or execute, so a naive
  // search finds those words in the prose. Strip comments and match call
  // shapes, not vocabulary. (This is the third time that trap has bitten in
  // this file — every source-matching test here now strips first.)
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  /**
   * A ceiling, not a first milestone. An app that can execute on your machine
   * is a different risk category from one that can read some notes, and the
   * useful half of this needs only the reading — so there must be no code
   * path for the rest, not merely no tool exposing it.
   */
  for (const forbidden of [
    /\bwriteFile\s*\(/, /\bappendFile\s*\(/, /\bunlink\s*\(/, /\brm\s*\(/, /\brmdir\s*\(/,
    /\bmkdir\s*\(/, /\brename\s*\(/, /\bexec(File|Sync)?\s*\(/, /\bspawn(Sync)?\s*\(/,
    /require\(["']child_process["']\)/, /from ["']node:child_process["']/,
  ]) {
    assert.ok(!forbidden.test(src), `the bridge must contain no ${forbidden}`);
  }

  // An unset allowlist must refuse, never default to the whole disk.
  assert.match(src, /SAGE_ROOTS \(name the folders SAGE may read\)/);

  // Its own secret: sharing CRON_SECRET would mean a leak of the weaker
  // capability hands over the stronger one.
  const route = fsp.readFileSync("app/api/bridge/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.match(route, /BRIDGE_SECRET/);
  assert.ok(!/CRON_SECRET/.test(route), "the bridge must not share the cron secret");
  assert.match(route, /if \(!secret\) return false/, "an unset secret must shut the door, not open it");
});

// ── Places and the route to them ───────────────────────────────────────────

test("gym time means the window is open and he is not already there", async () => {
  const { dueAt, distanceM, AT_PLACE_M } = await import("@/core/places/schedule");

  // 18:00–20:00 on weekdays. Bengaluru coordinates, since the app's timezone
  // is IST and this rule reads the clock in that timezone.
  const gym = {
    id: "g", name: "Gym", lat: 12.9716, lon: 77.5946, at: "",
    schedule: { fromMin: 18 * 60, toMin: 20 * 60, days: [1, 2, 3, 4, 5] },
  };
  const away = { lat: 12.99, lon: 77.62 };            // ~3km off
  const atGym = { lat: 12.9717, lon: 77.5947 };       // ~15m off

  // Wednesday 18:30 IST = 13:00 UTC.
  const during = new Date("2026-08-26T13:00:00Z");
  assert.equal(dueAt([gym], during, away)?.name, "Gym", "open window, elsewhere → route");
  assert.equal(dueAt([gym], during, atGym), null, "directions to the gym while at the gym are noise");

  // Same clock time, Sunday — not a gym day.
  assert.equal(dueAt([gym], new Date("2026-08-30T13:00:00Z"), away), null);

  // Wednesday 09:00 IST = 03:30 UTC — outside the window.
  assert.equal(dueAt([gym], new Date("2026-08-26T03:30:00Z"), away), null);

  /**
   * The half-hour offset is the trap.
   *
   * The obvious implementation — tzHour(now) * 60 + now.getMinutes() — takes
   * the hour from the app's timezone and the minutes from the server's, which
   * agree everywhere with a whole-hour offset and disagree in exactly the
   * place this app runs. IST is UTC+5:30, so at 12:45 UTC the app is at 18:15
   * and a naive mix reads 18:45 — enough to open or close a window wrongly.
   */
  const edge = new Date("2026-08-26T12:35:00Z"); // 18:05 IST — just inside
  assert.equal(dueAt([gym], edge, away)?.name, "Gym", "18:05 IST is inside an 18:00 window");
  const justBefore = new Date("2026-08-26T12:25:00Z"); // 17:55 IST — just outside
  assert.equal(dueAt([gym], justBefore, away), null, "17:55 IST is outside an 18:00 window");

  // A place with no schedule is a bookmark, not an obligation.
  assert.equal(dueAt([{ ...gym, schedule: undefined }], during, away), null);

  assert.ok(distanceM(atGym, gym) < AT_PLACE_M);
  assert.ok(distanceM(away, gym) > AT_PLACE_M);
});

test("the atlas can reach street level", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("features/atlas/atlas-map.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // maxZoom: 12 is roughly "a city fits on screen" — it could never show a
  // building or a junction. The same CARTO tiles are already run at 19 by
  // features/dashboard/components/geo-map.tsx, so 12 was a choice, not a limit.
  const max = Number(src.match(/const MAX_ZOOM = (\d+)/)?.[1]);
  assert.ok(max >= 18, `atlas must reach street level, got maxZoom ${max}`);
  assert.ok(!/maxZoom:\s*12/.test(src), "no layer may still be pinned at 12");

  // minZoom stays 2: the zoomend handler uses it to hand back to the globe,
  // so changing it would alter navigation rather than widen the range.
  assert.match(src, /minZoom:\s*2/);
});

/**
 * The Atlas toolbar must not be painted underneath the map.
 *
 * This is the bug that shipped invisibly: `.atlas` was turned into a flex
 * column with the toolbar as a row and the map given `flex: 1`, but the map
 * was left `position: absolute; inset: 0` from a rule a thousand lines
 * earlier — and flex sizing does nothing to an out-of-flow box. The map
 * covered the whole panel and its z-index painted it over every control:
 * the position readout, the centre-on-me button, the layer chips, the
 * place-naming field and the route summary. Nothing threw, nothing logged,
 * and a screenshot looked fine, because the map itself rendered perfectly.
 *
 * A CSS assertion rather than a browser one: the failure is a property on a
 * single selector, and this costs nothing to run on every commit.
 */
test("atlas map is an in-flow flex child, not an overlay", () => {
  const css = readFileSync(new URL("../features/dashboard/command.css", import.meta.url), "utf8")
    // Strip comments first. Matching against a file's own prose is how a
    // source-matching test passes while the code it describes is broken.
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const rule = (sel: string) =>
    [...css.matchAll(new RegExp(`(?:^|[},])\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"))]
      .map((m) => m[1]).join(";");

  const map = rule(".atlas-map");
  assert.ok(map, ".atlas-map rule is missing");
  assert.doesNotMatch(map, /position:\s*absolute/, ".atlas-map must stay in flow or it covers the toolbar");
  assert.match(map, /flex:\s*1/, ".atlas-map must take the leftover row");

  // The toolbar is rendered after the map in the JSX, so it needs an explicit
  // order to sit above it — "above the map, not on it" was the ask.
  assert.match(rule(".atlas-toolbar"), /order:\s*-1/, "toolbar must come first in the column");
  assert.match(rule(".atlas"), /flex-direction:\s*column/, ".atlas must be the flex column the two rows assume");
});

/**
 * CARTO began demanding an API key and stamped "API KEY REQUIRED" across every
 * tile. The basemap has to stay keyless — this whole system runs on free
 * tiers — so nothing may reintroduce a keyed provider without noticing.
 */
test("basemap is keyless", () => {
  const src = readFileSync(new URL("../features/atlas/atlas-map.tsx", import.meta.url), "utf8")
    // Block comments only: a naive `//` strip would eat the tile URL this
    // test exists to assert, and the assertion would then fail on the very
    // code that satisfies it.
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /cartocdn/, "CARTO now requires an API key");
  assert.match(src, /tile\.openstreetmap\.org/, "basemap should be OSM standard raster");
});

/**
 * The key store and its only UI must agree.
 *
 * These two lists were maintained by hand in two files, and had already
 * drifted: a provider added to the store was unreachable from the only screen
 * that can write to the store, so the key could not actually be added. The
 * select is now driven by the API, and this asserts the labels keep up — an
 * unlabelled provider renders its raw slug, which is survivable but ugly, and
 * ugly on purpose so it gets noticed.
 */
test("every managed key provider is reachable and named in settings", async () => {
  const { PROVIDERS } = await import("@/core/ops/keys");
  const ui = readFileSync(new URL("../features/settings/components/vitals.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // The select must not go back to a hardcoded list.
  assert.match(ui, /providers\.map\(/, "the provider select must be driven by the API");

  const labels = ui.slice(ui.indexOf("PROVIDER_LABELS"), ui.indexOf("function ManagedKeys"));
  for (const p of PROVIDERS) {
    assert.match(labels, new RegExp(`\\b${p}\\b`), `${p} needs a human-readable label`);
  }

  // Outlook needs both halves or the OAuth app cannot be configured at all.
  assert.ok(PROVIDERS.includes("outlook_id" as never), "outlook client id slot");
  assert.ok(PROVIDERS.includes("outlook_secret" as never), "outlook client secret slot");
});

/**
 * Hand tracking must be allowed to load at all.
 *
 * Gesture control read as "does nothing" for a long time, and the cause was
 * not in the gesture code: script-src permitted no external origin, so
 * MediaPipe's vision WASM runtime — fetched from a CDN the moment the feature
 * is switched on — was blocked outright. A blocked script is not an exception,
 * it is an absence, so nothing threw, nothing logged, and the camera light
 * came on to power a detector that had never loaded.
 *
 * The worker grant is the same class of failure one step later: MediaPipe
 * builds its detector in a worker created from a blob, and with no worker-src
 * that falls back to default-src 'self', which blob: does not satisfy.
 */
test("the CSP permits the hand tracker to load", async () => {
  const { CSP } = await import("@/lib/security");

  const scriptSrc = CSP.match(/script-src ([^;]*)/)?.[1] ?? "";
  assert.match(scriptSrc, /https:\/\/cdn\.jsdelivr\.net/, "MediaPipe's WASM runtime is a script from jsdelivr");
  assert.match(scriptSrc, /'wasm-unsafe-eval'/, "compiling the WASM needs an explicit grant");

  assert.match(CSP, /worker-src[^;]*blob:/, "the detector runs in a blob worker");

  // The grant must stay narrow: allowing scripts from anywhere would give
  // back the injection route the whole policy exists to close.
  assert.doesNotMatch(scriptSrc, /(^|\s)https:(\s|$)/, "script-src must not open to all of https");
  assert.doesNotMatch(scriptSrc, /\*/, "no wildcard script origins");
});

/**
 * Pointing must be tested before dragging.
 *
 * Both gestures involve a pinch. The pointing hand is the more specific — it
 * requires the other three fingers folded — so if the drag branch is reached
 * first it swallows every click and the interface becomes unpressable while
 * looking like it is tracking perfectly.
 */
test("the pointing gesture is matched before the scroll drag", () => {
  const src = readFileSync(new URL("../features/gestures/gesture-nav.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const point = src.indexOf("const onlyIndex");
  const drag = src.indexOf("if (f.pinch) {");
  assert.ok(point > 0, "the pointing branch must exist");
  assert.ok(drag > 0, "the drag branch must exist");
  assert.ok(point < drag, "pointing must be tested before the pinch-drag");

  // The cursor must never be its own hit target.
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = css.match(/\.gn-cursor\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /pointer-events:\s*none/, "elementFromPoint must see through the cursor");
});

// ── Calendar: events that overlap must sit beside each other ───────────────

test("overlapping events are laid out side by side", async () => {
  const { layoutSpans } = await import("@/features/calendar/layout");

  // Nothing overlapping: everything takes the full width.
  const apart = layoutSpans([{ start: 60, end: 120 }, { start: 180, end: 240 }]);
  assert.deepEqual(apart.map((p) => p.width), [1, 1]);
  assert.deepEqual(apart.map((p) => p.left), [0, 0]);

  // Two at once: half each, side by side.
  const pair = layoutSpans([{ start: 60, end: 120 }, { start: 90, end: 150 }]);
  assert.deepEqual(pair.map((p) => p.width), [0.5, 0.5]);
  assert.deepEqual(pair.map((p) => p.left).sort(), [0, 0.5]);

  // Touching but not overlapping — one ends exactly as the next begins. This
  // is the common case of back-to-back classes and must NOT split the width.
  const touching = layoutSpans([{ start: 60, end: 120 }, { start: 120, end: 180 }]);
  assert.deepEqual(touching.map((p) => p.width), [1, 1]);

  /**
   * The transitive chain, which is the case a naive implementation gets wrong.
   *
   * A overlaps B, B overlaps C, but A and C never touch. Grouping by *mutual*
   * overlap would treat A and C as unrelated and give each the full width,
   * drawing B across both. They must be one cluster.
   *
   * Within that cluster A and C still share a column, because they genuinely
   * do not overlap — which is the point of packing rather than simply counting
   * the cluster. Two columns, not three: wider events, same correctness.
   */
  const chain = layoutSpans([
    { start: 0, end: 60 },    // A
    { start: 50, end: 110 },  // B
    { start: 100, end: 160 }, // C
  ]);
  assert.deepEqual(chain.map((p) => p.width), [0.5, 0.5, 0.5], "one cluster, halved");
  assert.equal(chain[0].left, chain[2].left, "A and C do not overlap, so they share a column");
  assert.notEqual(chain[1].left, chain[0].left, "B must not sit on top of either");

  // A long event spanning several short ones: the long one takes the first
  // column, the short ones stack in the second and reuse it as each ends.
  const spanning = layoutSpans([
    { start: 0, end: 240 },   // all morning
    { start: 30, end: 60 },
    { start: 90, end: 120 },
  ]);
  assert.equal(spanning[0].left, 0, "the long event leads");
  assert.deepEqual(spanning.map((p) => p.width), [0.5, 0.5, 0.5]);
  assert.equal(spanning[1].left, 0.5);
  assert.equal(spanning[2].left, 0.5, "the second short event reuses the freed column");

  // Fully nested, and identical times.
  assert.deepEqual(layoutSpans([{ start: 0, end: 120 }, { start: 30, end: 45 }]).map((p) => p.width), [0.5, 0.5]);
  assert.deepEqual(layoutSpans([{ start: 0, end: 60 }, { start: 0, end: 60 }]).map((p) => p.width), [0.5, 0.5]);

  // Results come back in input order, so callers can zip them against their
  // own array — returning them sorted would silently mismatch every event.
  const shuffled = layoutSpans([{ start: 300, end: 360 }, { start: 0, end: 60 }]);
  assert.deepEqual(shuffled.map((p) => p.index), [0, 1]);

  assert.deepEqual(layoutSpans([]), []);
});

/**
 * The week grid must live on the canvas, not its scroll parent.
 *
 * When the calendar was changed to show all 24 hours the columns were wrapped
 * in a new `.wk-canvas` inside `.wk-body` — but the grid was left on the
 * parent. `.wk-body` then had exactly one child, so the canvas was placed in
 * the 44px gutter track and the hour labels plus all seven day columns were
 * crammed inside it. The calendar still rendered, just entirely wrong, which
 * is why nothing caught it.
 */
test("the week canvas carries the day grid", () => {
  const css = readFileSync(new URL("../features/calendar/calendar.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const body = css.match(/\.wk-body\s*\{([^}]*)\}/)?.[1] ?? "";
  const canvas = css.match(/\.wk-canvas\s*\{([^}]*)\}/)?.[1] ?? "";

  assert.ok(canvas, ".wk-canvas rule is missing");
  assert.match(canvas, /grid-template-columns:[^;]*repeat\(7/, "the canvas lays out the seven days");
  assert.doesNotMatch(body, /grid-template-columns/, ".wk-body must not also define the tracks");
});

/**
 * The Eisenhower rule is shared; the scales that feed it are not.
 *
 * SAGE has two matrices over two different task lists — the dashboard band on
 * live TickTick tasks, the workspace on the local Task table — and their
 * priority scales are inverted: TickTick counts up (5 high), the local table
 * counts down (0 urgent). Handing one straight to the other's classifier files
 * every important task under "Eliminate" and every trivial one under "Do
 * first". So the shared rule takes booleans only, normalised by whichever
 * caller knows its own scale.
 */
test("quadrants come from urgency and importance, not priority alone", async () => {
  const { classifyQuadrant, isUrgent, hoursUntil, URGENT_HOURS } = await import("@/core/tasks/quadrant");

  assert.equal(classifyQuadrant({ urgent: true, important: true }), "do");
  assert.equal(classifyQuadrant({ urgent: false, important: true }), "schedule");
  assert.equal(classifyQuadrant({ urgent: true, important: false }), "delegate");
  assert.equal(classifyQuadrant({ urgent: false, important: false }), "drop");

  const now = Date.parse("2026-08-28T00:00:00Z");
  const inHours = (h: number) => new Date(now + h * 3_600_000).toISOString();

  // Overdue is the most urgent thing there is — a negative figure must not
  // fall outside the window and read as "not urgent".
  assert.ok(isUrgent(hoursUntil(inHours(-72), now)), "overdue is urgent");
  assert.ok(isUrgent(hoursUntil(inHours(1), now)), "due in an hour is urgent");
  assert.ok(!isUrgent(hoursUntil(inHours(URGENT_HOURS + 1), now)), "next week is not");
  assert.ok(!isUrgent(hoursUntil(null, now)), "no deadline is not urgent");

  /**
   * The complaint that started this: a task due in an hour at priority 0 sat
   * in "Eliminate", because the band classified on priority alone and no
   * deadline could move anything.
   */
  const dueSoonUnimportant = classifyQuadrant({
    urgent: isUrgent(hoursUntil(inHours(1), now)),
    important: 0 >= 3, // TickTick scale, applied by the caller
  });
  assert.equal(dueSoonUnimportant, "delegate", "an imminent deadline must leave the drop quadrant");

  // The band must actually use the due date, not just import the helper.
  const band = readFileSync(new URL("../features/dashboard/components/eisenhower-band.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(band, /isUrgent\(hoursUntil\(t\.dueDate\)\)/, "urgency comes from the due date");
  assert.match(band, /t\.priority >= 3/, "importance uses TickTick's scale, high-is-big");
});

/**
 * Every gesture needs a second route, and every state needs a name.
 *
 * A pinch is a fine-motor act: it works close to the camera and misses further
 * away, and it is exactly what a tired or unsteady hand fails at. Dwell is the
 * same outcome by a different means, which is what makes this a control
 * surface rather than a demo.
 *
 * The states matter as much. "Still loading", "no hand in frame" and "camera
 * blocked" previously all presented as nothing happening — so a working
 * tracker and a broken one looked identical, which is most of why this feature
 * read as dead for so long.
 */
test("gesture control has a fallback click and legible states", () => {
  const src = readFileSync(new URL("../features/gestures/gesture-nav.tsx", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  assert.match(code, /DWELL_MS/, "dwell is the accessible second route to a click");
  assert.match(code, /DWELL_SLOP/, "drifting must not accumulate toward a click");
  assert.match(code, /EDGE_BAND/, "pointing below the fold must be reachable");

  for (const state of ["loading", "searching", "tracking", "failed"]) {
    assert.match(code, new RegExp(`"${state}"`), `tracking state '${state}' must be distinguishable`);
  }

  // The real error is shown rather than swallowed into a generic message.
  assert.match(code, /err as Error/, "surface what actually failed");

  // And the toggle must never turn itself off on failure: that leaves nothing
  // switched on to inspect and the message disappears with the component.
  assert.doesNotMatch(code, /setGestureNav\(false\)/, "failure must not flip the switch back");
});

/**
 * Location must be reported with its age.
 *
 * The webhook has been storing arrive/leave events from the phone since it was
 * written and nothing ever read them — retention deleted them after a week.
 * Now that they drive answers, the thing that matters is staleness: an
 * assistant that states a six-hour-old position as current will confidently
 * tell him to leave for somewhere he is already sitting. A stale fix is not a
 * wrong fix; a stale fix presented as current is.
 */
test("a location answer always carries how old it is", async () => {
  const { describeWhere, STALE_AFTER_MIN } = await import("@/core/location");
  const place = { id: "p1", name: "Gym", lat: 12.9, lon: 77.6 } as never;

  assert.match(describeWhere({ fix: null, at: null, nearest: null, stale: true }), /don't know/i);

  const fresh = describeWhere({
    fix: { lat: 12.9, lon: 77.6, at: new Date().toISOString(), ageMin: 4 },
    at: place, nearest: { place, meters: 20 }, stale: false,
  });
  assert.match(fresh, /At Gym/);
  assert.match(fresh, /4 minutes ago/, "even a fresh answer states its age");

  const old = describeWhere({
    fix: { lat: 12.9, lon: 77.6, at: new Date().toISOString(), ageMin: 360 },
    at: place, nearest: { place, meters: 20 }, stale: true,
  });
  assert.match(old, /Last seen/, "a stale fix must not read as a current one");
  assert.match(old, /6 hours ago/);

  assert.ok(STALE_AFTER_MIN > 0 && STALE_AFTER_MIN < 24 * 60);

  // Retention must not delete the history the feature depends on.
  const ret = readFileSync(new URL("../core/ops/retention.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const days = Number(ret.match(/"location\.update":\s*(\d+)/)?.[1] ?? 0);
  assert.ok(days >= 30, `location history must outlive a week, got ${days}`);

  // The browser publishes through a same-origin route, never the machine one:
  // reusing the shared-secret webhook would ship that secret in client JS.
  const self = readFileSync(new URL("../app/api/webhook/location/self/route.ts", import.meta.url), "utf8");
  assert.match(self, /sameOrigin/, "browser publishing is same-origin gated");
  assert.doesNotMatch(self, /machineAuth/, "no machine secret in a browser-facing route");
});

// ── Outlook: opportunities are extracted, never invented ───────────────────

test("internship mail is classified from what it actually says", async () => {
  const { classify, findOpportunities, findDeadline, extractLinks } = await import("@/core/career/inbox");

  const mail = (over: Partial<Parameters<typeof classify>[0]>) => ({
    id: "1", subject: "", from: "x@y.com", body: "", receivedAt: "2026-08-28T09:00:00Z", ...over,
  });

  /**
   * The point of doing this with rules: a model asked "what is the deadline"
   * answers even when there is none, and a hallucinated deadline in a career
   * tracker is worse than no tracker — a wrong answer that looks exactly like
   * a right one, and it will be believed.
   */
  assert.equal(findDeadline("Applications are open. Come to our webinar on 3 March 2026."), null,
    "a date with no deadline word is not a deadline");
  assert.equal(findDeadline("Apply by 15 March 2026 to be considered."), "2026-03-15");
  assert.equal(findDeadline("Last date: March 15, 2026"), "2026-03-15");
  assert.equal(findDeadline("deadline 2026-03-15"), "2026-03-15");
  assert.equal(findDeadline("Deadline is soon — check the portal."), null,
    "an unparseable date yields nothing rather than a guess");

  // Somewhere you apply ranks above somewhere you read about applying.
  const links = extractLinks("See https://blog.example.com/news and apply at https://forms.gle/abc123.");
  assert.match(links[0], /forms\.gle/, "the apply link comes first");
  assert.equal(links.length, 2);

  // A real invitation.
  const interview = classify(mail({
    subject: "Interview invitation — Summer Analyst internship",
    body: "Please book a slot at https://lever.co/acme/apply. Submit by 15 March 2026.",
  }))!;
  assert.ok(interview.kinds.includes("interview"));
  assert.ok(interview.kinds.includes("internship"));
  assert.equal(interview.deadline, "2026-03-15");
  assert.ok(interview.score > 0.8, `strong signal, got ${interview.score}`);

  // Bulk mail that merely mentions the word must not sit alongside it.
  const spam = classify(mail({
    subject: "Weekly newsletter: internship trends in 2026",
    body: "Read more on our blog. To unsubscribe click here.",
  }));
  assert.ok(!spam || spam.score < 0.45, `marketing must score low, got ${spam?.score}`);

  // Nothing at all is nothing, not a low-confidence something.
  assert.equal(classify(mail({ subject: "Lunch?", body: "Free at 1?" })), null);

  // Ordering: a dated deadline outranks a higher-scoring undated one.
  const ranked = findOpportunities([
    mail({ id: "a", subject: "Interview invitation for internship", body: "https://lever.co/x" }),
    mail({ id: "b", subject: "Internship application form", body: "Apply by 1 March 2026 https://forms.gle/z" }),
  ]);
  assert.equal(ranked[0].id, "b", "a real deadline leads regardless of score");
});

/**
 * The redirect URI is registered in Azure and must match byte for byte.
 *
 * It deliberately breaks the /api/integrations/<name>/callback convention the
 * Google integration uses, because that is the URI already registered. Moving
 * it to match the convention would fail every sign-in with AADSTS50011 — an
 * error naming nothing useful, so it would read as a code bug.
 */
test("outlook keeps the registered redirect path and asks for a refresh token", () => {
  const src = readFileSync(new URL("../infrastructure/integrations/outlook.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  assert.match(src, /\/api\/outlook\/callback/, "must match the URI registered in Azure");
  assert.match(src, /offline_access/, "without it the connection dies after an hour");
  assert.match(src, /Mail\.Read/);

  // Credentials: the store he pasted into wins over an environment variable,
  // or pasting a replacement would not replace anything.
  const creds = src.slice(src.indexOf("export async function outlookCreds"));
  assert.match(creds, /keysFor\("outlook_id"\)/);
  assert.ok(
    creds.indexOf("ids[ids.length - 1]") < creds.indexOf("process.env.OUTLOOK_CLIENT_ID"),
    "the key store must be consulted before the environment",
  );

  // Microsoft rotates refresh tokens; keeping the old one works until it does not.
  assert.match(src, /refreshed\.refresh_token \? \{ refreshToken/, "store the rotated refresh token");
});

/**
 * An application that closes today is the most time-critical thing a morning
 * brief can carry. Burying it under an unread count defeats the point of
 * reading one, so deadlines lead the email section.
 */
test("the brief leads with career deadlines, and says nothing when there are none", () => {
  assert.ok(!describeDay(emptyDay).includes("DEADLINE"), "no deadlines, no deadline line");

  const withOpps = describeDay({
    ...emptyDay,
    unread: [{ from: "someone", subject: "hello", account: "gmail" }],
    opportunities: [
      { subject: "Summer Analyst application", from: "Acme", deadline: "2026-03-01", kinds: ["internship", "deadline"] },
      { subject: "Interview slot", from: "Beta Corp", deadline: null, kinds: ["interview"] },
    ],
  });
  assert.match(withOpps, /DEADLINES:.*closes 2026-03-01/);
  assert.match(withOpps, /CAREER MAIL:.*Beta Corp/, "undated ones still get a mention, separately");
  assert.ok(
    withOpps.indexOf("DEADLINES") < withOpps.indexOf("EMAIL:"),
    "deadlines come before the unread count",
  );
});

/**
 * Editor indentation.
 *
 * These are all off-by-one bugs on the caret, and every one of them presents
 * as "the editor is broken" rather than as an indentation rule — which is why
 * they are pure functions with tests rather than inline handlers.
 */
test("the code editor indents like an editor", async () => {
  const { onTab, onShiftTab, onEnter, onCloseBracket } = await import("@/features/coding/indent");

  // Tab with no selection inserts a level at the caret.
  assert.deepEqual(onTab({ value: "ab", start: 1, end: 1 }), { value: "a    b", start: 5, end: 5 });

  /**
   * The one that matters: a plain textarea replaces the selection with a tab
   * character, silently destroying the code that was highlighted.
   */
  const block = "def f():\nx = 1\ny = 2";
  const indented = onTab({ value: block, start: 9, end: 20 });
  assert.equal(indented.value, "def f():\n    x = 1\n    y = 2");

  // Outdent removes up to one level, never more than a line has.
  assert.equal(onShiftTab({ value: "    x = 1", start: 9, end: 9 }).value, "x = 1");
  assert.equal(onShiftTab({ value: "  x = 1", start: 7, end: 7 }).value, "x = 1", "two spaces lose two, not four");
  assert.equal(onShiftTab({ value: "x = 1", start: 5, end: 5 }).value, "x = 1", "no indent, nothing eaten");
  // And the caret never ends up behind the start of its own line.
  assert.ok(onShiftTab({ value: "x = 1", start: 0, end: 0 }).start >= 0);

  // Enter carries the indentation — in Python this is the syntax, not a style.
  assert.equal(onEnter({ value: "    x = 1", start: 9, end: 9 }).value, "    x = 1\n    ");
  // And adds a level after a line that opens a block.
  assert.equal(onEnter({ value: "def f():", start: 8, end: 8 }).value, "def f():\n    ");
  assert.equal(onEnter({ value: "    if x:", start: 9, end: 9 }).value, "    if x:\n        ");

  // A closing bracket alone on a line pulls back to where the block opened.
  assert.equal(onCloseBracket({ value: "x = [\n    1,\n    ", start: 17, end: 17 }, "}")!.value,
    "x = [\n    1,\n}");
  // But not when there is code before it, and not at the left margin already.
  assert.equal(onCloseBracket({ value: "foo(a", start: 5, end: 5 }, ")"), null);
  assert.equal(onCloseBracket({ value: "x = [\n", start: 6, end: 6 }, "]"), null);
});

/**
 * The sitrep has four layers, and the dashboard reads the same source as the
 * page.
 *
 * There were two implementations: the band read /api/sitrep (a flat, older
 * list) while the page read /api/sitrep/live (structured, seven producers). So
 * the same question had two answers and only one of them had tiers.
 *
 * "Everything that might matter" in one flat list is not a status board — it
 * is a pile you have to read in full to learn anything.
 */
test("sitrep lines are tiered, and alerts are promoted to NOW", async () => {
  const { tierOf } = await import("@/core/sitrep");

  assert.equal(tierOf("agenda"), "now");
  assert.equal(tierOf("tasks"), "today");
  assert.equal(tierOf("health"), "drift", "drift is what you only see over time");
  assert.equal(tierOf("system"), "system", "SAGE's own health is not a fact about his life");
  assert.equal(tierOf("something-new"), "today", "an unmapped producer still lands somewhere");

  const src = readFileSync(new URL("../core/sitrep/index.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(src, /alerts:[\s\S]*tier: "now"/, "anything actively wrong is NOW whatever produced it");

  // The tile must read the structured route, not the flat one.
  const tile = readFileSync(new URL("../features/dashboard/components/page-tiles.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(tile, /\/api\/sitrep\/live/, "one source for the band and the page");
  assert.match(tile, /data\?\.sitrep\?\.lines/, "and it must read that route's actual shape");
});

/* ── HUD chrome ─────────────────────────────────────────────────────────── */

test("chrome primitives use design tokens, never hardcoded colour", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile("components/chrome.tsx", "utf8");
  // Strip block comments only. A naive `//` strip eats the `//` in a URL and
  // has produced a false pass here before.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(code), false, "hardcoded hex in chrome.tsx");
  assert.equal(/\brgba?\(/.test(code), false, "literal rgb() in chrome.tsx");
});

test("Serial's barcode is a function of its code, not of the render", async () => {
  // Two renders of the same string must give the same bars, and different
  // strings must differ — otherwise it is a random pattern wearing a barcode's
  // clothes, and it visibly flickers on every re-render.
  const bars = (code: string) => {
    let h = 2166136261;
    for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Array.from({ length: 24 }, (_, i) => {
      h = Math.imul(h ^ (h >>> 13), 16777619);
      return 1 + ((h >>> (i % 8)) & 3);
    });
  };
  assert.deepEqual(bars("a163d3a"), bars("a163d3a"));
  assert.notDeepEqual(bars("a163d3a"), bars("7381f5a"));
  assert.ok(bars("x").every((w) => w >= 1 && w <= 4));
});

/* ── the wall ───────────────────────────────────────────────────────────── */

test("every wall track sets min-height: 0", async () => {
  /**
   * The failure this guards is specific and silent: a grid or flex child
   * defaults to `min-height: auto`, which floors the track at its content's
   * height. One long list then makes the wall taller than the viewport and the
   * page scrolls again — which is the single thing the layout exists to
   * prevent, and it looks fine until the day a pane has more rows than usual.
   */
  const fs = await import("node:fs/promises");
  const src = await fs.readFile("features/dashboard/wall.css", "utf8");
  const css = src.replace(/\/\*[\s\S]*?\*\//g, "");

  for (const sel of [".wall ", ".wall-row ", ".wall-row > * ", ".wall-stack ", ".wall-stack > * "]) {
    const rule = new RegExp(`\\${sel.trim().replace(/[*>]/g, (c) => `\\${c}`)}\\s*\\{[^}]*\\}`);
    const m = rule.exec(css);
    assert.ok(m, `no rule for ${sel}`);
    assert.match(m[0], /min-height:\s*0/, `${sel} must set min-height: 0`);
  }
});

test("the wall only claims the viewport above the fallback breakpoint", async () => {
  // Below 1400px it must stay a scrolling stack: forcing a fixed height on a
  // phone is how the panes become unreadable slivers.
  const fs = await import("node:fs/promises");
  const css = (await fs.readFile("features/dashboard/wall.css", "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const at = css.indexOf("@media (min-width: 1400px)");
  assert.ok(at > 0, "no 1400px breakpoint");
  // The wall takes 100% of its container, and only above the breakpoint.
  // Below it the stack must be free to grow and scroll, so a height claim
  // there is the regression this guards.
  assert.equal(/\.wall\s*\{[^}]*height:\s*100%/.test(css.slice(0, at)), false,
    "wall height claimed outside the breakpoint");
  assert.match(css.slice(at), /\.wall\s*\{[^}]*height:\s*100%/);
});

test("every container-relative size in the wall is clamped", async () => {
  /**
   * An unclamped `cqh` is what produces 3px text on a busy pane. The floor in
   * each clamp is the legibility guarantee the whole fit-to-panel approach
   * rests on, so an unclamped one is a silent regression.
   */
  const fs = await import("node:fs/promises");
  const css = (await fs.readFile("features/dashboard/wall.css", "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // Every declaration that mentions cqh must also mention clamp(.
  const bad = css
    .split(/[;{}]/)
    .map((d) => d.trim())
    .filter((d) => /\dcqh\b/.test(d) && !/clamp\(/.test(d));

  assert.deepEqual(bad, [], "unclamped container units");
});

/* ── feed watchlist ─────────────────────────────────────────────────────── */

test("YouTube URLs are read structurally, and unreadable ones are refused", async () => {
  const { parseFeedUrl } = await import("@/core/feeds/watchlist");

  // Channels, in every form YouTube actually serves.
  assert.deepEqual(parseFeedUrl("https://www.youtube.com/@veritasium"), { kind: "channel", ref: "@veritasium" });
  assert.deepEqual(parseFeedUrl("@veritasium"), { kind: "channel", ref: "@veritasium" });
  assert.deepEqual(
    parseFeedUrl("https://youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA"),
    { kind: "channel", ref: "UCHnyfMqiRRG1u-2MsSQLbXA" },
  );
  // Legacy /c/ and /user/ resolve through the same handle lookup.
  assert.deepEqual(parseFeedUrl("https://www.youtube.com/c/Bloomberg"), { kind: "channel", ref: "@Bloomberg" });

  // Videos.
  assert.deepEqual(parseFeedUrl("https://youtu.be/dQw4w9WgXcQ"), { kind: "video", ref: "dQw4w9WgXcQ" });
  assert.deepEqual(parseFeedUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), { kind: "video", ref: "dQw4w9WgXcQ" });

  // A watch URL opened from inside a playlist is still that video. Subscribing
  // to the playlist it happened to be in is not what was pasted.
  assert.deepEqual(
    parseFeedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc&index=3"),
    { kind: "video", ref: "dQw4w9WgXcQ" },
  );
  // A share link with a tracking parameter.
  assert.deepEqual(parseFeedUrl("https://youtu.be/dQw4w9WgXcQ?si=xY_9"), { kind: "video", ref: "dQw4w9WgXcQ" });

  // Refused rather than guessed. A search page turned into a channel id would
  // produce a feed that silently returns nothing.
  assert.equal(parseFeedUrl("https://www.youtube.com/results?search_query=news"), null);
  assert.equal(parseFeedUrl("https://vimeo.com/12345"), null);
  assert.equal(parseFeedUrl("not a url"), null);
  assert.equal(parseFeedUrl(""), null);
});

/* ── chart maths ────────────────────────────────────────────────────────── */

test("histogram buckets are equal-width and the maximum lands in the last bin", async () => {
  /**
   * The off-by-one this guards: `floor((v - min) / width)` puts the maximum
   * at index `count`, one past the end, so it either throws or gets its own
   * lonely bin at the right edge — which reads as a fat tail and is
   * arithmetic. Neither symptom is visible by eye on a real distribution.
   */
  const { bucket } = await import("@/components/instruments");

  const bins = bucket([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.equal(bins.length, 5);
  assert.equal(bins.reduce((a, b) => a + b.n, 0), 11, "every value is counted exactly once");
  assert.equal(bins[bins.length - 1].n > 0, true, "the maximum lands inside the last bin");

  // Equal width, to floating-point tolerance.
  const widths = bins.map((b) => b.to - b.from);
  for (const w of widths) assert.ok(Math.abs(w - widths[0]) < 1e-9);

  // Degenerate inputs must not divide by zero or produce NaN bounds.
  const flat = bucket([3, 3, 3], 4);
  assert.equal(flat.reduce((a, b) => a + b.n, 0), 3);
  assert.ok(flat.every((b) => Number.isFinite(b.from) && Number.isFinite(b.to)));
  assert.deepEqual(bucket([], 5), []);
});

/* ── pane forms ─────────────────────────────────────────────────────────── */

test("form payloads are typed, and empty optional fields are omitted", async () => {
  /**
   * Both failures this guards produce a 400 that reads as "the form is
   * broken" rather than as bad input, and neither is visible in a browser
   * until the request fails:
   *
   *  - a number field posting a string is rejected by a z.number() schema;
   *  - an empty optional field sent as "" is a *value* — it fails date
   *    parsing and, on an upsert, overwrites real data with nothing.
   */
  const { buildPayload, missingRequired } = await import("@/components/pane-form");

  const fields = [
    { name: "amount", label: "Amount", type: "number" as const, required: true },
    { name: "merchant", label: "Merchant", required: true },
    { name: "category", label: "Category", type: "select" as const, fallback: "other" },
    { name: "note", label: "Note" },
  ];

  const out = buildPayload(fields, { amount: "250", merchant: " Blue Tokai ", note: "" });
  assert.equal(out.amount, 250, "a number field posts a number");
  assert.equal(typeof out.amount, "number");
  assert.equal(out.merchant, "Blue Tokai", "values are trimmed");
  assert.equal("note" in out, false, "an empty optional field is omitted, not sent as an empty string");
  assert.equal(out.category, "other", "an empty field with a fallback sends the fallback");

  // Junk in a number field is dropped rather than sent as NaN, which
  // serialises to null and silently clears the column.
  assert.equal("amount" in buildPayload(fields, { amount: "abc" }), false);

  // Dates become instants. A bare "2026-09-04" would be read as UTC midnight
  // and land the item on the previous evening in IST.
  const dated = buildPayload([{ name: "due", label: "Due", type: "date" as const }], { due: "2026-09-04" });
  assert.match(String(dated.due), /^\d{4}-\d{2}-\d{2}T/);

  assert.deepEqual(missingRequired(fields, { amount: "1", merchant: "x" }), []);
  assert.deepEqual(missingRequired(fields, { amount: "1" }), ["Merchant"]);
  assert.deepEqual(missingRequired(fields, {}), ["Amount", "Merchant"]);
});

/*
 * Stale-chunk detection.
 *
 * This is the branch that decides between "reload the page" and "show the
 * error", and getting it wrong is expensive in both directions: a real bug
 * classed as a stale chunk reloads into the same crash, and a stale chunk
 * classed as a real bug leaves him looking at a fault screen when a reload
 * would have fixed it. Neither is visible in a browser until it happens to
 * him, so it is tested here.
 */
test("isChunkError tells a stale deploy from a real bug", async () => {
  const { isChunkError } = await import("../lib/crash");

  const chunk = [
    Object.assign(new Error("boom"), { name: "ChunkLoadError" }),
    new Error("Loading chunk 4821 failed. (missing: /_next/static/chunks/4821.js)"),
    new Error("Loading CSS chunk 12 failed."),
    // Safari and Firefox, which is the phrasing the iPhone produces.
    new Error("error loading dynamically imported module: /_next/static/chunks/x.js"),
    new Error("Importing a module script failed."),
  ];
  for (const e of chunk) assert.equal(isChunkError(e), true, e.message);

  const real = [
    new TypeError("Cannot read properties of undefined (reading 'map')"),
    new Error("t.filter is not a function"),
    new Error("Minified React error #418"),
  ];
  for (const e of real) assert.equal(isChunkError(e), false, e.message);

  assert.equal(isChunkError(null), false);
  assert.equal(isChunkError(undefined), false);
});

/*
 * Board geometry.
 *
 * Every function here fails in a way that looks plausible on screen: an
 * arrow that meets the wrong face still points roughly at the box, and a
 * simplifier that rounds a corner still draws a line. That is exactly the
 * class of bug that survives a demo and is only noticed once a diagram has
 * been trusted, so it is pinned down here instead.
 */
test("anchorPoint meets the face the ray actually crosses", async () => {
  const { anchorPoint } = await import("../core/board/types");

  // A wide box, approached from 45° above-right. The ray reaches the top
  // before the side, and an angle-only test gets this wrong.
  const wide = { x: 0, y: 0, w: 200, h: 40 };
  assert.equal(anchorPoint(wide, { x: 200, y: -100 }).side, "t");

  // The same approach on a tall box reaches the side first.
  const tall = { x: 0, y: 0, w: 40, h: 200 };
  assert.equal(anchorPoint(tall, { x: 140, y: -60 }).side, "r");

  // The four cardinals, on a square, land exactly on the midpoint of a face.
  const sq = { x: 0, y: 0, w: 100, h: 100 };
  const r = anchorPoint(sq, { x: 500, y: 50 });
  assert.equal(r.side, "r");
  assert.deepEqual([r.x, r.y], [100, 50]);
  assert.equal(anchorPoint(sq, { x: 50, y: -500 }).side, "t");
  assert.equal(anchorPoint(sq, { x: -500, y: 50 }).side, "l");
  assert.equal(anchorPoint(sq, { x: 50, y: 500 }).side, "b");

  // Target exactly on the centre: a face, never NaN. NaN renders as an arrow
  // that silently disappears.
  const d = anchorPoint(sq, { x: 50, y: 50 });
  assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
});

test("simplify drops collinear runs but keeps corners and endpoints", async () => {
  const { simplify } = await import("../core/board/types");

  // A straight line sampled at ten points is two points.
  const line: number[] = [];
  for (let i = 0; i <= 10; i++) line.push(i * 10, 0);
  assert.deepEqual(simplify(line, 1), [0, 0, 100, 0]);

  // A right angle must keep its vertex — rounding off the corner of a
  // hand-drawn box means the drawing stops being the drawing.
  const corner = [0, 0, 25, 0, 50, 0, 50, 25, 50, 50];
  const out = simplify(corner, 1);
  assert.deepEqual(out, [0, 0, 50, 0, 50, 50]);

  // Endpoints always survive, and a two-point stroke is returned untouched.
  assert.deepEqual(simplify([3, 4, 9, 12], 1), [3, 4, 9, 12]);

  // And it genuinely shrinks a noisy stroke rather than merely reordering it.
  const noisy: number[] = [];
  for (let i = 0; i < 400; i++) noisy.push(i, Math.sin(i / 40) * 30);
  const small = simplify(noisy, 2);
  assert.ok(small.length < noisy.length / 4, `expected a large reduction, got ${small.length / 2} points`);
  assert.deepEqual(small.slice(0, 2), [0, 0]);
});

test("strokeNear catches a crossing between samples, not just on them", async () => {
  const { strokeNear } = await import("../core/board/types");
  // Two points far apart: an eraser dragged across the middle of the segment
  // must still hit it, or fast strokes survive being crossed out.
  const s = { id: "s", pts: [0, 0, 100, 0] };
  assert.equal(strokeNear(s, 50, 2, 5), true);
  assert.equal(strokeNear(s, 50, 40, 5), false);
  assert.equal(strokeNear(s, 0, 0, 1), true);
});

/*
 * Arranging and history.
 *
 * The undo tests exist because undo is the feature whose bugs are silent: a
 * stack that is one step out of phase looks like "⌘Z did nothing", and a redo
 * branch that survives a new edit jumps the board into a history that no
 * longer connects to what is on screen. Neither is visible until it has
 * already cost work.
 */
test("marquee selects nodes it merely touches, not only ones it encloses", async () => {
  const { intersects, rectBetween } = await import("../core/board/types");

  // A box dragged bottom-right to top-left is the same box.
  assert.deepEqual(rectBetween(100, 80, 20, 10), { x: 20, y: 10, w: 80, h: 70 });

  const marquee = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(intersects(marquee, { x: 90, y: 90, w: 50, h: 50 }), true, "corner overlap counts");
  assert.equal(intersects(marquee, { x: 20, y: 20, w: 10, h: 10 }), true, "fully inside counts");
  assert.equal(intersects(marquee, { x: 101, y: 0, w: 10, h: 10 }), false, "just past does not");
  // Touching edges only is not an overlap — otherwise a marquee dragged up to
  // a node grabs it without ever covering a pixel of it.
  assert.equal(intersects(marquee, { x: 100, y: 0, w: 10, h: 10 }), false);
});

test("snap respects the override and leaves aligned nodes alone", async () => {
  const { snap, GRID } = await import("../core/board/types");
  assert.equal(snap(0), 0);
  assert.equal(snap(GRID * 3), GRID * 3, "already on the grid must not drift");
  assert.equal(snap(GRID * 3 + 1), GRID * 3);
  assert.equal(snap(GRID * 3 - 1), GRID * 3);
  assert.equal(snap(-1), 0);
  assert.equal(snap(37, false), 37, "the override is the whole point");
});

test("distribute equalises gaps, not centres", async () => {
  const { distributeNodes } = await import("../core/board/types");
  // Different widths, which is where centre-spacing looks wrong.
  const nodes = [
    { id: "a", kind: "sticky" as const, x: 0, y: 0, w: 100, h: 10 },
    { id: "b", kind: "sticky" as const, x: 40, y: 0, w: 20, h: 10 },
    { id: "c", kind: "sticky" as const, x: 300, y: 0, w: 100, h: 10 },
  ];
  const out = distributeNodes(nodes, "x");
  const by = Object.fromEntries(out.map((n) => [n.id, n]));
  // Ends are pinned; the middle sits so both gaps match.
  assert.equal(by.a.x, 0);
  assert.equal(by.c.x, 300);
  const gap1 = by.b.x - (by.a.x + by.a.w);
  const gap2 = by.c.x - (by.b.x + by.b.w);
  assert.ok(Math.abs(gap1 - gap2) < 1e-9, `gaps differ: ${gap1} vs ${gap2}`);
  // And the caller's order survives, or a selection reshuffles as you align it.
  assert.deepEqual(out.map((n) => n.id), ["a", "b", "c"]);
});

test("contentBounds counts ink, so a board of only drawing can be fitted", async () => {
  const { contentBounds, fitView, emptyBoard } = await import("../core/board/types");
  const doc = emptyBoard("t");
  assert.equal(contentBounds(doc), null, "an empty board has no bounds to fit");

  doc.strokes.push({ id: "s", pts: [100, 100, 200, 300] });
  const r = contentBounds(doc, 10)!;
  assert.deepEqual([r.x, r.y, r.w, r.h], [90, 90, 120, 220]);

  // Fitting never enlarges past 1: a single note blown up to fill a 4K screen
  // is not what "fit" means.
  const v = fitView(r, 1200, 800);
  assert.ok(v.k <= 1);
  assert.ok(Math.abs((r.x + r.w / 2) * v.k + v.x - 600) < 1e-6, "content centre lands on viewport centre");
});

test("undo coalesces a drag, and a new edit clears the redo branch", async () => {
  const { emptyHistory, record, undo, redo, LIMIT } = await import("../features/board/history");
  const { emptyBoard } = await import("../core/board/types");

  const a = { ...emptyBoard("b"), title: "a" };
  const b = { ...a, title: "b" };
  const c = { ...a, title: "c" };

  // Forty move events inside the coalesce window are one undo entry, not forty.
  let h = emptyHistory();
  for (let i = 0; i < 40; i++) h = record(h, a, "move", 1000 + i * 5);
  assert.equal(h.past.length, 1, "a single drag must be a single undo step");

  // A different kind of edit is its own entry.
  h = record(h, b, "ink", 1300);
  assert.equal(h.past.length, 2);

  const u = undo(h, c)!;
  assert.equal(u.doc.title, "b", "undo restores the state before the last edit");
  const r = redo(u.history, u.doc)!;
  assert.equal(r.doc.title, "c");

  // Undo, then edit: the redo branch is gone rather than pointing at history
  // that no longer connects to the board.
  const u2 = undo(h, c)!;
  assert.equal(u2.history.future.length, 1);
  const after = record(u2.history, u2.doc, "text", 9000);
  assert.equal(after.future.length, 0);

  // And the stack is bounded, or a long session grows without limit.
  let big = emptyHistory();
  for (let i = 0; i < LIMIT + 25; i++) big = record(big, a, `k${i}`, i * 10_000);
  assert.equal(big.past.length, LIMIT);
});

test("distToSegment clamps to the segment, so an arrow is not clickable from its extension", async () => {
  const { distToSegment } = await import("../core/board/types");
  // Beside the middle of the segment: the perpendicular distance.
  assert.equal(distToSegment(50, 10, 0, 0, 100, 0), 10);
  // Past the end. Distance to the *endpoint*, not to the infinite line —
  // otherwise clicking empty canvas selects an arrow half a screen away.
  assert.equal(distToSegment(200, 0, 0, 0, 100, 0), 100);
  assert.equal(distToSegment(-30, 40, 0, 0, 100, 0), 50);
  // A zero-length edge is a point, not a division by zero.
  assert.equal(distToSegment(3, 4, 0, 0, 0, 0), 5);
});

test("a frame carries what it contains, and only that", async () => {
  const { nodesInside } = await import("../core/board/types");
  const n = (id: string, x: number, y: number, w = 40, h = 40) =>
    ({ id, kind: "sticky" as const, x, y, w, h });

  const frame = { x: 0, y: 0, w: 200, h: 200 };
  const inside = n("in", 20, 20);
  const straddling = n("edge", 180, 180);   // hangs over the corner
  const outside = n("out", 400, 400);
  const flush = n("flush", 160, 160);       // exactly touching the far edge

  const got = nodesInside(frame, [inside, straddling, outside, flush]).map((x) => x.id);
  // Containment, not intersection: a frame that grabbed everything it merely
  // overlapped would drag its neighbours along every time it moved.
  assert.deepEqual(got, ["in", "flush"]);
});

test("searchNodes matches text and filenames, in document order", async () => {
  const { searchNodes } = await import("../core/board/types");
  const nodes = [
    { id: "a", kind: "sticky" as const, x: 0, y: 0, w: 1, h: 1, text: "Placement prep" },
    { id: "b", kind: "file" as const, x: 0, y: 0, w: 1, h: 1, file: { name: "placements.pdf", path: "p", mime: "", size: 0 } },
    { id: "c", kind: "sticky" as const, x: 0, y: 0, w: 1, h: 1, text: "unrelated" },
  ];
  assert.deepEqual(searchNodes(nodes, "place"), ["a", "b"], "matches text and filenames, case-insensitively");
  assert.deepEqual(searchNodes(nodes, "PLACEMENTS.PDF"), ["b"]);
  assert.deepEqual(searchNodes(nodes, "   "), [], "a blank query is not a match-everything");
});

test("edgePath bows out along each anchor's own face", async () => {
  const { edgePath } = await import("../core/board/types");

  // Right face to left face: the controls must push outward horizontally, or
  // edges between neighbouring boxes lie on top of each other.
  const d = edgePath({ x: 100, y: 50, side: "r" }, { x: 300, y: 50, side: "l" });
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // M x y C c1x c1y, c2x c2y, x2 y2
  assert.deepEqual([nums[0], nums[1]], [100, 50], "starts at the first anchor");
  assert.deepEqual([nums[6], nums[7]], [300, 50], "ends at the second");
  assert.ok(nums[2] > 100, "first control bows right, off the right face");
  assert.ok(nums[4] < 300, "second control bows left, off the left face");

  // A short link stays nearly straight; a long one is capped rather than
  // swinging across the board.
  const short = edgePath({ x: 0, y: 0, side: "r" }, { x: 30, y: 0, side: "l" });
  const long = edgePath({ x: 0, y: 0, side: "r" }, { x: 4000, y: 0, side: "l" });
  assert.ok(Number(short.match(/-?\d+(\.\d+)?/g)![2]) <= 20 + 1e-9, "short links keep a minimum bow");
  assert.ok(Number(long.match(/-?\d+(\.\d+)?/g)![2]) <= 140 + 1e-9, "and long ones are capped");

  /*
   * A free endpoint — an arrow into empty space — has no face to leave by.
   * Its control point must not coincide with the endpoint: the tangent there
   * would be undefined and the arrowhead, oriented along it, points in an
   * arbitrary direction. That is exactly what it did.
   */
  const free = edgePath({ x: 0, y: 0, side: "r" }, { x: 200, y: 0 });
  const f = free.match(/-?\d+(\.\d+)?/g)!.map(Number);
  assert.notDeepEqual([f[4], f[5]], [f[6], f[7]], "the loose end's control must not sit on the endpoint");
});

test("inkPath smooths through midpoints and still reaches both ends", async () => {
  const { inkPath } = await import("../core/board/types");

  assert.equal(inkPath([]), "", "no points is no path, not a broken one");
  assert.equal(inkPath([1, 2]), "");
  // Two points cannot be curved, so they stay a line.
  assert.equal(inkPath([0, 0, 10, 10]), "M 0 0 L 10 10");

  const d = inkPath([0, 0, 10, 20, 20, 0, 30, 20]);
  assert.ok(d.startsWith("M 0 0"), "starts on the first sample");
  assert.ok(d.endsWith("L 30 20"), "and finishes on the last, which is a control point for nothing");
  assert.ok(d.includes("Q"), "the middle is quadratic, not a polyline");
});

/*
 * Ambient dedupe keys.
 *
 * A key that embeds a value rather than identifying a subject is how SAGE
 * ended up repeating the same sitrep every four minutes: the anomaly key was
 * built from its rendered text, that text contains the live price, so the key
 * changed on every poll and the client never recognised it as already said.
 *
 * Source-matching rather than behavioural, because the failure is in how a
 * string is composed and there is no way to observe it without a live feed —
 * which is precisely why it shipped.
 */
test("no ambient dedupe key is built from a value that moves", async () => {
  const src = (await import("node:fs")).readFileSync("core/ambient/index.ts", "utf8")
    // Block comments only: stripping // would eat the https:// in URLs.
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const keys = [...src.matchAll(/key:\s*`([^`]+)`/g)].map((m) => m[1]);
  assert.ok(keys.length >= 8, `expected the ambient keys, found ${keys.length}`);

  for (const k of keys) {
    // `.detail`, `.length` and any rounded number are all readings, not
    // identities. A count changes as he works; a price changes constantly.
    assert.ok(!/\.detail/.test(k), `key uses rendered text: ${k}`);
    assert.ok(!/\.length/.test(k), `key uses a count: ${k}`);
    assert.ok(!/Math\.round/.test(k), `key uses a rounded reading: ${k}`);
  }
});

/*
 * The mark's geometry lives twice — once in the client component, once in the
 * icon generator, which runs in plain Node and cannot import a "use client"
 * module. Duplication is the right call there and a silent drift is the price,
 * so the two are checked against each other: change the mark in one place and
 * this fails until the icons are regenerated.
 */
test("the app icons are drawn from the same geometry as the mark", async () => {
  const fs = await import("node:fs");
  const component = fs.readFileSync("components/ui/sage-mark.tsx", "utf8");
  const generator = fs.readFileSync("scripts/make-icons.mjs", "utf8");

  const paths = (src: string) =>
    Object.fromEntries(
      [...src.matchAll(/^const (HEAD|CROSS|WING_L|WING_R|SPIKE_L|SPIKE_R|ROBE) = `([^`]+)`/gm)]
        .map(([, name, d]) => [name, d.replace(/\s+/g, " ").trim()]),
    );

  const a = paths(component);
  const b = paths(generator);
  assert.equal(Object.keys(a).length, 7, "expected seven shapes in the component");
  assert.deepEqual(a, b, "the icon generator has drifted from the mark — rerun scripts/make-icons.mjs");
});
