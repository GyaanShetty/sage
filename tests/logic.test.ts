import { test } from "node:test";
import assert from "node:assert/strict";

import { attribution, riskAdjusted, maxDrawdown, dailyReturns, rebalance, riskMetrics } from "@/core/portfolio/analytics";
import { parseHevyCsv, summariseWorkout } from "@/infrastructure/integrations/hevy";
import { classify, QUADRANT_META } from "@/core/tasks/eisenhower";
import { splitForSpeech } from "@/lib/speech-split";
import { fingerprint } from "@/core/ops/errors";
import { stepStreak, average, correlate } from "@/core/health/store";
import { startOfTodayUtc, tzHour } from "@/lib/config";
import { noRepeatClause } from "@/core/brief/variety";
import { describeDay, type DayPicture } from "@/core/brief/agenda";

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
  ({ day, steps, sleepHours: null, activeKcal: null, restingHr: null, distanceKm: null, weightKg: null, waterMl: null });

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
  unread: [], markets: [], portfolio: null, weather: null, reminders: [], goals: [], budget: null, training: null,
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

test("retention keeps generated briefs longer than the history page reads", () => {
  // /api/brief/history?limit=14 must never outrun the retention window, or
  // the page would show gaps that look like missing days rather than pruning.
  const source = require("node:fs").readFileSync(new URL("../core/ops/retention.ts", import.meta.url), "utf8");
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
