/**
 * Two-way sync between SAGE's Task table and TickTick.
 *
 * What was there before was not sync, it was a broadcast: creating a task
 * in SAGE posted a copy to TickTick and threw the returned id away. With
 * no id there is no link, and with no link nothing can ever be matched
 * again — so completing a task in either place left the other showing it
 * as open, edits never crossed, and anything created in TickTick was
 * invisible to SAGE forever. Two lists that start identical and drift is
 * worse than one list, because you stop trusting either.
 *
 * ── Why a three-way merge
 *
 * Neither side gives a reliable modification time. SAGE's Task table has
 * no `updatedAt` column, and TickTick's API does not return one we can
 * depend on. So "who changed last" is unanswerable, and last-write-wins
 * would be a coin toss dressed up as a rule.
 *
 * Instead every linked pair remembers what both sides looked like at the
 * end of the previous sync (`seen`). A field that differs from `seen` on
 * exactly one side changed there, and is copied to the other. That is a
 * real answer rather than a guess, and it needs no clocks.
 *
 * ── The two rules that need stating
 *
 *   1. When BOTH sides changed the same field, TickTick wins. It is the
 *      app he actually edits tasks in; SAGE is where they get surfaced.
 *      A rule nobody can predict is worse than one that is occasionally
 *      not what you wanted.
 *   2. DONE is sticky and travels in both directions. Completing is
 *      almost always deliberate and un-completing almost never is, so a
 *      task done on either side ends done on both — even if the other
 *      side also edited its title.
 *
 * ── What it deliberately does not do
 *
 * It never deletes. A task that vanishes from TickTick might have been
 * deleted on purpose, or moved to a project outside the twelve the API
 * lists, or dropped by a failed page. Those are indistinguishable from
 * here, and destroying a task on an ambiguous signal is the one mistake
 * a sync must not make. The link is marked orphaned and the SAGE task is
 * left alone where he can see it.
 */

import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import {
  getTickTickTasks,
  createTickTask,
  completeTickTask,
  updateTickTask,
  type TickTask,
} from "@/infrastructure/integrations/ticktick";

const LINK = "task.sync.link";

/** SAGE statuses that mean "not finished". */
const OPEN = new Set(["todo", "doing", "pending"]);

export interface SageTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  dueAt: string | null;
  source: string | null;
}

/** The snapshot both sides are compared against. */
export interface Seen {
  title: string;
  done: boolean;
  dueAt: string | null;
  priority: number;
}

export interface TaskLink {
  taskId: string;
  tickId: string;
  projectId: string;
  seen: Seen;
  /** Set when the TickTick side stopped coming back. Never deletes. */
  orphanedAt?: string;
  updatedAt: string;
}

export interface SyncReport {
  ok: boolean;
  reason?: string;
  linked: number;
  adopted: number;
  createdInSage: number;
  createdInTickTick: number;
  completedInSage: number;
  completedInTickTick: number;
  editsToSage: number;
  editsToTickTick: number;
  orphaned: number;
}

/*
 * The two priority scales run in opposite directions, and getting this
 * backwards files everything urgent as trivial — quietly, and in the app
 * he actually looks at.
 */
const SAGE_TO_TICK: Record<number, number> = { 0: 5, 1: 3, 2: 1, 3: 0 };
const TICK_TO_SAGE: Record<number, number> = { 5: 0, 3: 1, 1: 2, 0: 3 };
const toTick = (p: number) => SAGE_TO_TICK[p] ?? 1;
const toSage = (p: number) => TICK_TO_SAGE[p] ?? 2;

/** Titles match across systems only after the differences nobody means. */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Both sides store dates differently; compare the instant, not the text. */
const sameWhen = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const [x, y] = [Date.parse(a), Date.parse(b)];
  if (Number.isNaN(x) || Number.isNaN(y)) return a === b;
  /* A minute of slack: TickTick rounds, and a one-second difference is not
     an edit anybody made. */
  return Math.abs(x - y) < 60_000;
};

async function loadLinks(): Promise<{ link: TaskLink; rowId: string }[]> {
  const { data } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", LINK)
    .limit(2000);
  const out: { link: TaskLink; rowId: string }[] = [];
  for (const row of data ?? []) {
    const l = row.payload as TaskLink;
    if (l?.taskId && l?.tickId) out.push({ link: l, rowId: row.id as string });
  }
  return out;
}

async function writeLink(link: TaskLink, rowId?: string) {
  const payload = { ...link, updatedAt: new Date().toISOString() };
  if (rowId) {
    await db.from("Event").update({ payload }).eq("id", rowId);
  } else {
    await db.from("Event").insert({
      id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: LINK, payload,
    });
  }
}

const seenOfSage = (t: SageTask): Seen => ({
  title: t.title, done: !OPEN.has(t.status), dueAt: t.dueAt ?? null, priority: t.priority,
});
const seenOfTick = (t: TickTask): Seen => ({
  title: t.title, done: t.status === 2, dueAt: t.dueDate ?? null, priority: toSage(t.priority),
});

/**
 * What a single linked pair should do, given both sides and the snapshot.
 *
 * Pulled out of the sync loop and made pure so it can be tested: this is
 * the one piece of the whole feature that has to be RIGHT, and it is
 * impossible to exercise against a live TickTick from a test. Everything
 * around it is reading and writing; this is the reasoning.
 */
export interface Decision {
  /** Fields SAGE should take from TickTick. */
  toSage: { title?: string; dueAt?: string | null; priority?: number };
  /** Fields TickTick should take from SAGE, in SAGE's priority scale. */
  toTick: { title?: string; dueAt?: string | null; priority?: number };
  /** Which side needs completing, if either. */
  complete: "sage" | "ticktick" | null;
  /** What both sides will look like once this is applied. */
  nextSeen: Seen;
}

export function decide(was: Seen, nowS: Seen, nowT: Seen): Decision {
  const d: Decision = { toSage: {}, toTick: {}, complete: null, nextSeen: { ...nowT } };

  /* DONE first, and sticky in both directions: completing is almost
     always deliberate, un-completing almost never is. */
  if (nowS.done !== nowT.done) {
    d.complete = nowS.done ? "ticktick" : "sage";
    d.nextSeen.done = true;
  }

  /* Then each field by who moved it. Both moved → TickTick, because that
     is the app he actually edits in. */
  const tTitle = nowT.title !== was.title;
  if (tTitle) d.toSage.title = nowT.title;
  else if (nowS.title !== was.title) d.toTick.title = nowS.title;

  const tDue = !sameWhen(nowT.dueAt, was.dueAt);
  if (tDue) d.toSage.dueAt = nowT.dueAt;
  else if (!sameWhen(nowS.dueAt, was.dueAt)) d.toTick.dueAt = nowS.dueAt;

  const tPri = nowT.priority !== was.priority;
  if (tPri) d.toSage.priority = nowT.priority;
  else if (nowS.priority !== was.priority) d.toTick.priority = nowS.priority;

  /* Whatever TickTick is about to receive is true on both sides after. */
  if (d.toTick.title !== undefined) d.nextSeen.title = d.toTick.title;
  if (d.toTick.dueAt !== undefined) d.nextSeen.dueAt = d.toTick.dueAt;
  if (d.toTick.priority !== undefined) d.nextSeen.priority = d.toTick.priority;

  return d;
}

/**
 * Record the pair the moment both halves exist.
 *
 * Called by whatever just created a task on both sides, so the link is
 * exact rather than adopted-by-title later.
 */
export async function linkTask(
  taskId: string,
  tick: { id: string; projectId: string },
  seen: Seen,
): Promise<void> {
  await writeLink({
    taskId, tickId: tick.id, projectId: tick.projectId,
    seen, updatedAt: new Date().toISOString(),
  });
}

/**
 * Reconcile both lists.
 *
 * Returns a report rather than throwing: this runs on the heartbeat, and
 * a sync that dies silently is how two lists drift for a week before
 * anybody notices.
 */
export async function syncTasks(): Promise<SyncReport> {
  const report: SyncReport = {
    ok: false, linked: 0, adopted: 0,
    createdInSage: 0, createdInTickTick: 0,
    completedInSage: 0, completedInTickTick: 0,
    editsToSage: 0, editsToTickTick: 0, orphaned: 0,
  };

  const ticks = await getTickTickTasks();
  if (ticks === null) return { ...report, reason: "TickTick is not connected" };

  const { data: sageRows, error } = await db
    .from("Task")
    .select("id, title, status, priority, dueAt, source")
    .eq("userId", DEFAULT_USER_ID)
    .neq("status", "cancelled")
    .limit(500);
  if (error) return { ...report, reason: error.message };

  const sage = (sageRows ?? []) as SageTask[];
  const byId = new Map(sage.map((t) => [t.id, t]));
  const byTickId = new Map(ticks.map((t) => [t.id, t]));

  const links = await loadLinks();
  const linkByTask = new Map(links.map((l) => [l.link.taskId, l]));
  const linkByTick = new Map(links.map((l) => [l.link.tickId, l]));

  /*
   * Adoption, before anything is created.
   *
   * The old fire-and-forget mirroring left real pairs on both sides with
   * no link between them. Creating fresh copies for those would double
   * every task he already has, so an unlinked pair with the same title is
   * adopted as an existing link first. Nothing is written to either
   * system here — only the link that should have been recorded the first
   * time.
   */
  const freeTicks = ticks.filter((t) => !linkByTick.has(t.id));
  const freeSage = sage.filter((t) => !linkByTask.has(t.id));
  const tickByTitle = new Map<string, TickTask>();
  for (const t of freeTicks) if (!tickByTitle.has(norm(t.title))) tickByTitle.set(norm(t.title), t);

  for (const s of freeSage) {
    const match = tickByTitle.get(norm(s.title));
    if (!match) continue;
    tickByTitle.delete(norm(s.title));
    const link: TaskLink = {
      taskId: s.id, tickId: match.id, projectId: match.projectId,
      /* Seeded from TickTick so the first real sync treats any difference
         as a SAGE-side edit rather than replaying both sides at once. */
      seen: seenOfTick(match),
      updatedAt: new Date().toISOString(),
    };
    await writeLink(link);
    linkByTask.set(s.id, { link, rowId: "" });
    linkByTick.set(match.id, { link, rowId: "" });
    report.adopted++;
  }

  /* ── linked pairs ──────────────────────────────────────────────── */

  for (const entry of await loadLinks()) {
    const { link, rowId } = entry;
    const s = byId.get(link.taskId);
    const t = byTickId.get(link.tickId);

    if (!s) continue;                       // gone from SAGE; nothing to do
    if (!t) {
      if (!link.orphanedAt) {
        await writeLink({ ...link, orphanedAt: new Date().toISOString() }, rowId);
        report.orphaned++;
      }
      continue;
    }

    report.linked++;
    const d = decide(link.seen, seenOfSage(s), seenOfTick(t));

    if (d.complete === "ticktick") {
      const ok = await completeTickTask(t.projectId, t.id).catch(() => false);
      if (ok) report.completedInTickTick++;
      else d.nextSeen.done = false;   // it did not take; try again next pass
    } else if (d.complete === "sage") {
      await db.from("Task").update({ status: "done" })
        .eq("id", s.id).eq("userId", DEFAULT_USER_ID);
      report.completedInSage++;
    }

    if (Object.keys(d.toSage).length) {
      await db.from("Task").update(d.toSage).eq("id", s.id).eq("userId", DEFAULT_USER_ID);
      report.editsToSage++;
    }
    if (Object.keys(d.toTick).length) {
      const ok = await updateTickTask(t.projectId, t.id, {
        ...(d.toTick.title !== undefined ? { title: d.toTick.title } : {}),
        ...(d.toTick.dueAt !== undefined ? { dueAt: d.toTick.dueAt } : {}),
        ...(d.toTick.priority !== undefined ? { priority: toTick(d.toTick.priority) } : {}),
      }).catch(() => false);
      if (ok) report.editsToTickTick++;
      /* A refused edit must not be remembered as applied, or the change is
         lost forever — next pass would see SAGE matching `seen`. */
      else d.nextSeen = { ...d.nextSeen, ...seenOfTick(t) };
    }

    await writeLink({ ...link, seen: d.nextSeen, orphanedAt: undefined }, rowId);
  }

  /* ── TickTick tasks SAGE has never seen ────────────────────────── */

  for (const t of ticks) {
    if (linkByTick.has(t.id)) continue;
    /* Finished work does not need importing — it would arrive already done
       and only make the list longer. */
    if (t.status === 2) continue;
    const id = crypto.randomUUID();
    const { error: insErr } = await db.from("Task").insert({
      id, userId: DEFAULT_USER_ID,
      title: t.title, status: "todo",
      priority: toSage(t.priority), source: "ticktick",
      ...(t.dueDate ? { dueAt: t.dueDate } : {}),
    });
    if (insErr) continue;
    await writeLink({
      taskId: id, tickId: t.id, projectId: t.projectId,
      seen: seenOfTick(t), updatedAt: new Date().toISOString(),
    });
    linkByTick.set(t.id, { link: { taskId: id, tickId: t.id, projectId: t.projectId, seen: seenOfTick(t), updatedAt: "" }, rowId: "" });
    report.createdInSage++;
  }

  /* ── SAGE tasks TickTick has never seen ────────────────────────── */

  for (const s of sage) {
    if (linkByTask.has(s.id)) continue;
    if (!OPEN.has(s.status)) continue;
    /* A task that came FROM TickTick and lost its link must not be pushed
       back as a new one — that is how duplicates breed. */
    if (s.source === "ticktick") continue;

    const created = await createTickTask({
      title: s.title, dueAt: s.dueAt, priority: s.priority,
    }).catch(() => null);
    if (!created) continue;
    await writeLink({
      taskId: s.id, tickId: created.id, projectId: created.projectId,
      seen: seenOfSage(s), updatedAt: new Date().toISOString(),
    });
    report.createdInTickTick++;
  }

  return { ...report, ok: true };
}
