/**
 * The things that notice.
 *
 * A producer looks at one slice of the world and proposes what it thinks
 * should happen. They run on the heartbeat, they are allowed to find
 * nothing, and they must never throw past their own boundary — one feed
 * being down is not a reason for the other producers to stop running, and
 * `Promise.allSettled` here is the difference between "the receipts
 * producer failed" and "SAGE stopped noticing things".
 *
 * Each producer is responsible for a stable `dedupe` key. That key is the
 * entire defence against an assistant that asks the same question every
 * five minutes, which is the behaviour that gets an assistant turned off.
 */

import { listExpenses, findExpenseCandidates } from "@/core/finance/expenses";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";
import { listSubjects } from "@/core/study/subjects";
import { propose } from "../store";
import { mailDirectives } from "./mail";
import { readNewsletters } from "./newsletters";
import type { ProposalKind } from "../types";

export interface ProducerReport { name: string; proposed: number; error?: string }

const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/* ── receipts in the mailbox ───────────────────────────────────────────── */

async function receipts(): Promise<number> {
  const found = await findExpenseCandidates();
  let n = 0;
  for (const c of found) {
    const id = await propose({
      kind: "expense.file" as ProposalKind,
      title: `File ${rupees(c.amount)} — ${c.merchant}`,
      why: `A receipt in your mail dated ${c.date.slice(0, 10)}, read as ${c.category}${c.recurring ? " and recurring" : ""}.`,
      payload: { ...c },
      // Merchant + amount + day: the same charge read twice is one proposal,
      // and two genuinely separate coffees on one day stay two.
      dedupe: `expense|${c.merchant.toLowerCase()}|${Math.round(c.amount)}|${c.date.slice(0, 10)}`,
    });
    if (id) n++;
  }
  return n;
}

/* ── the study block that fits ─────────────────────────────────────────── */

/**
 * Only ever proposes ONE, and only for tomorrow.
 *
 * A producer that can emit twenty proposals in a pass will, the first time
 * a calendar is empty, and twenty study blocks is not a plan — it is a
 * wall of things to dismiss. One concrete suggestion a day is a thing you
 * answer; twenty is a thing you ignore.
 */
async function studyBlock(): Promise<number> {
  const subjects = await listSubjects().catch(() => []);
  if (!subjects.length) return 0;

  // The subject furthest from done, which is the one worth the next hour.
  const behind = [...subjects].sort((a, b) => {
    const done = (s: typeof a) => {
      const units = (s as { units?: { done?: boolean }[] }).units ?? [];
      return units.length ? units.filter((u) => u.done).length / units.length : 1;
    };
    return done(a) - done(b);
  })[0];
  if (!behind) return 0;

  const from = new Date(); from.setDate(from.getDate() + 1); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setHours(23, 59, 59, 999);
  /* The calendar helper takes a count, not a range, and returns null when
     Google is not connected — which is a different thing from "nothing is
     on", and the two must not collapse into the same suggestion. */
  const upcoming = (await listUpcomingEvents(25).catch(() => null)) ?? [];
  const tomorrow = upcoming.filter((e) => {
    const t = new Date((e as { start: string }).start).getTime();
    return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
  });

  /* Evening, after the day's commitments. Finding a true free gap needs the
     calendar to be complete, and it is not — he has classes that are not in
     it. So this proposes the hour after the last thing that IS known, and
     says so, rather than pretending to have found a gap. */
  const last = tomorrow
    .map((e) => new Date((e as { start: string }).start).getTime())
    .sort((a, b) => b - a)[0];

  const at = new Date(last ? last + 90 * 60_000 : from.getTime() + 19 * 3600_000);
  if (at.getHours() < 16) at.setHours(19, 0, 0, 0);

  const day = at.toISOString().slice(0, 10);
  const name = (behind as { name?: string }).name ?? "study";
  const id = await propose({
    kind: "study.schedule" as ProposalKind,
    title: `Study ${name} tomorrow, ${at.toTimeString().slice(0, 5)}`,
    why: last
      ? `${name} is the subject you are furthest behind on, and tomorrow's calendar is clear after ${new Date(last).toTimeString().slice(0, 5)}.`
      : `${name} is the subject you are furthest behind on, and nothing is on tomorrow's calendar yet.`,
    payload: { subject: name, at: at.toISOString(), minutes: 60 },
    dedupe: `study|${name.toLowerCase()}|${day}`,
  });
  return id ? 1 : 0;
}

/* ── the spend that wants a decision ───────────────────────────────────── */

/**
 * Not an action — a directive. Some things SAGE should not do for him; it
 * should put them in front of him. A subscription that renewed and has not
 * been used is a decision, and proposing "cancel it" would be proposing
 * something irreversible on evidence this thin.
 */
async function recurringReview(): Promise<number> {
  const exps = await listExpenses(45);
  const subs = new Map<string, { amount: number; date: string }>();
  for (const e of exps) if (e.recurring) subs.set(e.merchant, { amount: e.amount, date: e.date });
  if (subs.size < 3) return 0;

  const total = [...subs.values()].reduce((a, x) => a + x.amount, 0);
  const month = new Date().toISOString().slice(0, 7);
  const id = await propose({
    kind: "task.create" as ProposalKind,
    title: `Review ${subs.size} subscriptions — ${rupees(total)} a month`,
    why: `${[...subs.keys()].slice(0, 3).join(", ")}${subs.size > 3 ? " and others" : ""} renewed in the last 45 days. Worth a look once a month, not a cancellation SAGE should make for you.`,
    payload: { title: `Review subscriptions (${rupees(total)}/mo)`, priority: 2 },
    dedupe: `subs-review|${month}`,
  });
  return id ? 1 : 0;
}

const PRODUCERS: { name: string; run: () => Promise<number> }[] = [
  { name: "receipts", run: receipts },
  { name: "mail", run: mailDirectives },
  { name: "newsletters", run: readNewsletters },
  { name: "study", run: studyBlock },
  { name: "subscriptions", run: recurringReview },
];

export async function runProducers(): Promise<ProducerReport[]> {
  const rs = await Promise.allSettled(PRODUCERS.map(async (p) => ({ name: p.name, proposed: await p.run() })));
  return rs.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { name: PRODUCERS[i].name, proposed: 0, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
  );
}
