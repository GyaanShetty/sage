import { tzHour, tzDay, TZ, endOfTodayUtc } from "@/lib/config";

/**
 * What is worth saying out loud, from everywhere.
 *
 * The first version of this spoke market moves and nothing else, and it was not
 * because markets were judged important. The voice filtered for `high`, the
 * sitrep only ever marks overdue tasks and bad air as high, and the anomaly
 * detector — which tagged *everything* it found as high — mostly finds price
 * swings. So one accidental path was the only one open, and SAGE became a
 * ticker that occasionally mentioned SOL.
 *
 * This gathers from every domain instead, ranks by how much it would cost to
 * miss the item, and hands back one thing at a time. Markets are in the list.
 * They are near the bottom of it, because a coin moving is information and a
 * meeting in ten minutes is a consequence.
 */

export type Urgency = "now" | "soon" | "notice";

export interface AmbientItem {
  /** Stable across polls, so the same thing is not announced twice. */
  key: string;
  urgency: Urgency;
  /** Said aloud. Written to be heard, not read — no markup, no lists. */
  text: string;
  /** Which part of the system noticed. Shown, never spoken. */
  domain: string;
  href?: string;
}

/**
 * The order things get said in.
 *
 * Not a priority number per source, which drifts the moment anyone adds one.
 * A cost: what happens if he never hears it. A meeting missed cannot be
 * recovered; a coin's move can be read later, and will still be there.
 */
const URGENCY_RANK: Record<Urgency, number> = { now: 0, soon: 1, notice: 2 };

const DOMAIN_RANK: Record<string, number> = {
  calendar: 0,     // starts without you
  reminder: 1,     // you asked to be told, at a time
  task: 2,         // a deadline you set
  exam: 3,         // a date that does not move
  mail: 4,
  health: 5,
  money: 6,        // budget: a month is long enough to correct course
  study: 7,
  decision: 8,
  market: 9,       // a number that will still be there in an hour
  system: 10,
};

export function rankAmbient(items: AmbientItem[]): AmbientItem[] {
  return [...items].sort((a, b) => {
    const u = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    if (u !== 0) return u;
    return (DOMAIN_RANK[a.domain] ?? 99) - (DOMAIN_RANK[b.domain] ?? 99);
  });
}

/**
 * The one thing to say now, if anything.
 *
 * Anything already said today is skipped: repeating "three tasks overdue"
 * every three minutes is how a voice earns the mute button. `notice` items are
 * held back entirely unless nothing more urgent is waiting, so a quiet day can
 * still surface a nudge without a busy one burying the meeting under it.
 */
/**
 * How much each domain deserves the floor, once urgency has had its say.
 *
 * DOMAIN_RANK is a strict order, and a strict order plus "take the first one"
 * is why this only ever read the market. Not because the market ranked highly
 * — it ranks second to last — but because it was usually the only thing with
 * anything to say: prices move every few minutes, while a meeting is only
 * imminent for one window a day. Last in a list of one is still first.
 *
 * Weights fix the tie-break rather than the order. Two things can both be
 * worth saying, and which one gets said should not be the same every time —
 * that is what made it feel canned.
 */
/**
 * How far an asset must move before it is worth interrupting for.
 *
 * The old detector spoke about any move it considered anomalous, which for a
 * volatile asset is most days.
 */
const MARKET_MIN_MOVE_PCT = Number(process.env.SAGE_MARKET_MIN_MOVE_PCT ?? 8);

const DOMAIN_WEIGHT: Record<string, number> = {
  calendar: 12,
  reminder: 10,
  task: 10,
  exam: 6,
  study: 5,
  mail: 4,
  health: 4,
  money: 3,
  decision: 3,
  system: 2,
  // Deliberately the floor. A coin moving a few percent is the least
  // consequential thing SAGE knows and it was doing nearly all the talking.
  market: 1,
};

/** Pick one, favouring the domains that matter, without being predictable. */
export function weightedPick(
  items: AmbientItem[],
  rand: () => number = Math.random,
): AmbientItem | null {
  if (items.length === 0) return null;
  const weights = items.map((i) => DOMAIN_WEIGHT[i.domain] ?? 2);
  const total = weights.reduce((a, w) => a + w, 0);
  let roll = rand() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * The one thing to say now, if anything.
 *
 * Anything already said today is skipped: repeating "three tasks overdue"
 * every three minutes is how a voice earns the mute button. `notice` items are
 * held back entirely unless nothing more urgent is waiting, so a quiet day can
 * still surface a nudge without a busy one burying the meeting under it.
 *
 * Within a tier the choice is weighted-random rather than "the first one",
 * so the same two items on the same quiet afternoon do not produce the same
 * sentence every time.
 */
export function nextToSay(
  items: AmbientItem[],
  seen: Record<string, string>,
  now = new Date(),
  rand: () => number = Math.random,
): AmbientItem | null {
  const hour = tzHour(now);
  // Nothing here is worth being woken for. Notifications still deliver
  // overnight; they do it silently.
  if (hour < 7 || hour >= 23) return null;

  const fresh = rankAmbient(items).filter((i) => !seen[i.key]);
  if (fresh.length === 0) return null;

  /**
   * Urgency is absolute; the weighting only breaks ties inside a tier.
   *
   * A meeting starting in ten minutes must beat two overdue tasks every single
   * time — randomising across tiers would make the most important announcement
   * a coin flip, which is worse than the predictability it was meant to fix.
   * So: take the most urgent tier present, and choose at random only among
   * things that are equally urgent.
   */
  const pressing = fresh.filter((i) => i.urgency !== "notice");
  if (pressing.length) {
    const topTier = pressing[0].urgency; // fresh is already ranked
    return weightedPick(pressing.filter((i) => i.urgency === topTier), rand);
  }

  // Only chatter left, and this is the tier the market lives in — so this is
  // where varying the choice actually matters. Say one, and only in the parts
  // of the day where an unprompted remark is not an intrusion.
  return hour >= 9 && hour < 21 ? weightedPick(fresh, rand) : null;
}

/** Today's key, so yesterday's announcements do not suppress today's. */
export function seenKeyForToday(): string {
  return tzDay();
}

// ── gathering ──────────────────────────────────────────────────────────────

/**
 * Everything, from every corner of the system.
 *
 * Each source is raced independently and allowed to fail: a dead integration
 * must not silence the rest, which is exactly the failure that made this
 * market-only in the first place.
 */
export async function gatherAmbient(): Promise<AmbientItem[]> {
  const items: AmbientItem[] = [];
  const now = Date.now();
  const push = (i: AmbientItem) => items.push(i);

  await Promise.all([
    // ── the calendar: things that start whether or not you are ready ──────
    (async () => {
      const { upcomingEvents } = await import("@/core/calendar");
      const events = await upcomingEvents(6, 1);
      let mentionedLater = false;
      for (const e of events) {
        if (e.allDay || !e.start) continue;
        const mins = Math.round((new Date(e.start).getTime() - now) / 60_000);
        if (mins < 0) continue;

        if (mins <= 45) {
          push({
            key: `cal:${e.id ?? e.summary}:${new Date(e.start).toISOString()}`,
            urgency: mins <= 15 ? "now" : "soon",
            domain: "calendar",
            text: `${e.summary} in ${mins} minute${mins === 1 ? "" : "s"}${e.location ? `, at ${e.location}` : ""}.`,
            href: "/calendar",
          });
          continue;
        }

        /**
         * The next thing today, mentioned once.
         *
         * The 45-minute window above is the only thing the calendar could ever
         * say, which left it silent for most of the day — and silence from the
         * calendar is why the market ended up doing all the talking. A quiet
         * "your next thing is at four" is worth having; six of them are not,
         * so only the first gets through.
         */
        if (!mentionedLater && mins <= 8 * 60) {
          mentionedLater = true;
          const at = new Date(e.start);
          const clock = new Intl.DateTimeFormat("en-GB", {
            timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true,
          }).format(at);
          const hours = Math.round(mins / 60);
          push({
            key: `cal:next:${e.id ?? e.summary}:${tzDay()}`,
            urgency: "notice",
            domain: "calendar",
            text: `Next up today: ${e.summary}, at ${clock} — about ${hours} hour${hours === 1 ? "" : "s"} away.`,
            href: "/calendar",
          });
        }
      }
    })().catch(() => undefined),

    // ── tasks past their date ─────────────────────────────────────────────
    (async () => {
      const { db, DEFAULT_USER_ID } = await import("@/infrastructure/db/supabase");
      const { data } = await db
        .from("Task").select("id, title, dueAt")
        .eq("userId", DEFAULT_USER_ID).neq("status", "done").neq("status", "cancelled")
        .lt("dueAt", new Date().toISOString()).order("dueAt", { ascending: true }).limit(5);
      if (data?.length) {
        push({
          key: `task:overdue:${data.length}:${tzDay()}`,
          urgency: "soon",
          domain: "task",
          text: data.length === 1
            ? `${data[0].title} is past its date.`
            : `${data.length} tasks are past their date. The oldest is ${data[0].title}.`,
          href: "/workspace",
        });
      }

      /**
       * Still due today.
       *
       * "Overdue" is the only thing tasks could report, which means the task
       * domain had nothing to say until something had already gone wrong. The
       * useful remark is the one that arrives while there is still time to act
       * on it.
       */
      const { data: today } = await db
        .from("Task").select("id, title, dueAt")
        .eq("userId", DEFAULT_USER_ID).neq("status", "done").neq("status", "cancelled")
        .gte("dueAt", new Date().toISOString())
        // endOfTodayUtc, not setHours(23,59) — that would be the server's
        // midnight, which is UTC here and 05:29 IST the next morning.
        .lte("dueAt", endOfTodayUtc())
        .order("dueAt", { ascending: true }).limit(5);
      if (today?.length) {
        push({
          key: `task:today:${today.length}:${tzDay()}`,
          urgency: "notice",
          domain: "task",
          text: today.length === 1
            ? `Still on for today: ${today[0].title}.`
            : `${today.length} tasks are still due today. First up is ${today[0].title}.`,
          href: "/workspace",
        });
      }
    })().catch(() => undefined),

    // ── the exam that is not moving ───────────────────────────────────────
    (async () => {
      const { listExams, nextExam, daysUntil } = await import("@/core/exam");
      const next = nextExam(await listExams());
      if (!next) return;
      const days = daysUntil(next.at);
      if (days < 0 || days > 7) return;
      push({
        key: `exam:${next.id}:${days}`,
        urgency: days <= 1 ? "now" : "soon",
        domain: "exam",
        text: days === 0
          ? `${next.subject} is today.`
          : `${days} day${days === 1 ? "" : "s"} to ${next.subject}.`,
        href: "/exam",
      });
    })().catch(() => undefined),

    // ── money: the month running away ─────────────────────────────────────
    (async () => {
      const { getPlan, budgetStatus, currentMonth } = await import("@/core/finance/budget");
      const { listExpenses } = await import("@/core/finance/expenses");
      const plan = await getPlan(currentMonth());
      if (!plan) return;
      const status = budgetStatus(plan, await listExpenses(60));
      const over = status.lines.filter((l) => l.state === "over");
      if (over.length) {
        push({
          key: `money:over:${over.map((l) => l.category).join(",")}:${tzDay()}`,
          urgency: "notice",
          domain: "money",
          text: `You are over budget on ${over.map((l) => l.category).join(" and ")}.`,
          href: "/portfolio",
        });
      }
    })().catch(() => undefined),

    // ── health ────────────────────────────────────────────────────────────
    (async () => {
      const { listDays, getGoals } = await import("@/core/health/store");
      const [days, goals] = await Promise.all([listDays(7), getGoals()]);
      const slept = days.filter((d) => d.sleepHours != null);
      if (slept.length >= 3) {
        const debt = slept.reduce((a, d) => a + (goals.sleepHours - (d.sleepHours as number)), 0);
        if (debt > 5) {
          push({
            key: `health:sleep:${Math.round(debt)}:${tzDay()}`,
            urgency: "notice",
            domain: "health",
            text: `You are about ${debt.toFixed(0)} hours down on sleep this week.`,
            href: "/health",
          });
        }
      }
    })().catch(() => undefined),

    // ── study: what is owed ───────────────────────────────────────────────
    (async () => {
      const { listConcepts, dueOf } = await import("@/core/feynman");
      const due = dueOf(await listConcepts());
      if (!due.length) return;
      push({
        key: `study:explain:${due.length}:${tzDay()}`,
        urgency: "notice",
        domain: "study",
        text: due.length === 1
          ? `One thing is waiting to be explained back: ${due[0].title}.`
          : `${due.length} concepts are waiting to be explained back.`,
        href: "/explain",
      });
    })().catch(() => undefined),

    // ── decisions owed a verdict ──────────────────────────────────────────
    (async () => {
      const { listDecisions, dueForReview } = await import("@/core/decisions/store");
      const due = dueForReview(await listDecisions());
      if (!due.length) return;
      push({
        key: `decision:${due[0].id}:${tzDay()}`,
        urgency: "notice",
        domain: "decision",
        text: `A decision is due a verdict: ${due[0].title}.`,
        href: "/decisions",
      });
    })().catch(() => undefined),

    // ── the night's work, once ────────────────────────────────────────────
    (async () => {
      const { latestNightReport } = await import("@/core/night/shift");
      const report = await latestNightReport();
      if (!report || report.quiet || report.day !== tzDay()) return;
      push({
        key: `system:night:${report.day}`,
        urgency: "notice",
        domain: "system",
        text: `${report.items.length} thing${report.items.length === 1 ? "" : "s"} came in overnight.`,
        href: "/dashboard",
      });
    })().catch(() => undefined),

    // ── departures from his own baselines, and the market ─────────────────
    (async () => {
      const { detectAnomalies } = await import("@/core/anomaly");
      // Two at most. This source used to be the only one that could speak, and
      // it is verbose — left unbounded it would drown out everything above.
      for (const a of (await detectAnomalies(2)).slice(0, 2)) {
        const isMarket = /price|\b(up|down)\b\s|%/i.test(a.detail);

        /**
         * A few percent is not news.
         *
         * "SOL up 3.2%" is a normal Tuesday for a crypto asset, and saying it
         * out loud gave a routine number the same weight as a missed meeting.
         * Below the threshold it stays on the dashboard, where a number that
         * will still be there in an hour belongs.
         */
        if (isMarket) {
          const biggest = Math.max(
            0,
            ...[...a.detail.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1])),
          );
          if (biggest < MARKET_MIN_MOVE_PCT) continue;
        }

        push({
          key: `anomaly:${a.detail.slice(0, 40)}:${tzDay()}`,
          urgency: "notice",
          domain: isMarket ? "market" : "system",
          text: a.detail,
          href: "/sitrep",
        });
      }
    })().catch(() => undefined),
  ]);

  return rankAmbient(items);
}
