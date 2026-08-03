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
  unread: [], markets: [], portfolio: null, weather: null, reminders: [], goals: [], training: null,
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
