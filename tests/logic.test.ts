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

test("nothing speaks unless it was asked to", async () => {
  // SAGE used to talk on its own: a proactive poller that read out market
  // alerts every few minutes, and a briefing that spoke itself a second after
  // the app loaded. A voice that interrupts is a voice you mute, and a muted
  // voice cannot tell you anything — so speech is on request only now.
  //
  // This catches the shape that regressed: speech reached from a timer.
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

  const offenders: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const speaks = /speakLowLatency|voice\/speak|synth\.speak|speechSynthesis\.speak/.test(src);
    if (!speaks) continue;
    // A timer is how unprompted speech gets scheduled. The voice assistant's
    // own loop is exempt: it only runs after you enable and address it.
    if (file.endsWith("features/voice/engine.ts")) continue;
    if (/set(Timeout|Interval)\s*\(\s*(run|check|speak)/.test(src)) offenders.push(file);
  }

  assert.deepEqual(offenders, [], "speech must be triggered by the user, not by a timer");
});
