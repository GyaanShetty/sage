/**
 * Doing the thing, and being able to take it back.
 *
 * One function per kind, each returning what it made and how to unmake it.
 * The undo record is not optional for a reversible kind: writing the "how
 * to reverse this" at the moment of acting, while the ids are in hand, is
 * the only time it is cheap. Reconstructing it later from a description is
 * how undo buttons come to be lies.
 *
 * Execution never throws past this boundary. A producer that proposes
 * something impossible, an API that has gone away, a row that was deleted
 * by hand in between — all of it lands as `failed` with the message, in the
 * journal, where he can see it. An assistant that silently drops the work
 * it could not do is worse than one that does nothing.
 */

import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { addExpense, deleteExpense } from "@/core/finance/expenses";
import { archiveGmail, unarchiveGmail, ScopeError } from "@/infrastructure/integrations/google";
import { patchProposal } from "./store";
import { SAFETY, type Proposal } from "./types";

export interface Outcome {
  ok: boolean;
  label?: string;
  href?: string;
  undo?: Record<string, unknown>;
  error?: string;
}

const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

async function fileExpense(p: Proposal): Promise<Outcome> {
  const amount = Number(p.payload.amount);
  const merchant = String(p.payload.merchant ?? "").trim();
  if (!Number.isFinite(amount) || amount <= 0 || !merchant) {
    return { ok: false, error: "The proposal has no usable amount or merchant." };
  }
  const id = await addExpense({
    amount,
    merchant,
    category: String(p.payload.category ?? "other"),
    date: typeof p.payload.date === "string" ? p.payload.date : undefined,
    recurring: p.payload.recurring === true,
    source: "gmail",
  });
  return {
    ok: true,
    label: `${rupees(amount)} · ${merchant}`,
    href: "/portfolio",
    undo: { op: "expense.delete", id },
  };
}

async function createTask(p: Proposal): Promise<Outcome> {
  const title = String(p.payload.title ?? "").trim();
  if (!title) return { ok: false, error: "The proposal has no title." };
  const id = crypto.randomUUID();
  const { error } = await db.from("Task").insert({
    id,
    userId: DEFAULT_USER_ID,
    title,
    priority: Number(p.payload.priority ?? 2),
    ...(typeof p.payload.dueAt === "string" ? { dueAt: p.payload.dueAt } : {}),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, label: title, href: "/dashboard", undo: { op: "task.delete", id } };
}

async function scheduleStudy(p: Proposal): Promise<Outcome> {
  /*
   * A study block is a task with a time on it rather than a calendar event.
   * Writing to his real calendar is outward — it is a shared surface other
   * people's invitations land on — and this kind is classified as inward so
   * it can be automatic. If it ever writes to Google Calendar it has to be
   * reclassified, and `SAFETY` is where that decision lives.
   */
  const subject = String(p.payload.subject ?? "study").trim();
  const at = String(p.payload.at ?? "");
  const mins = Number(p.payload.minutes ?? 60);
  if (!at) return { ok: false, error: "The proposal has no time." };
  const id = crypto.randomUUID();
  const title = `Study: ${subject} (${mins}m)`;
  const { error } = await db.from("Task").insert({
    id, userId: DEFAULT_USER_ID, title, priority: 2, dueAt: at,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, label: title, href: "/study", undo: { op: "task.delete", id } };
}

/**
 * Archive a pile of mail.
 *
 * Partial success is reported as success with a count rather than rolled
 * back. Gmail has no transaction, so "undo the eleven that worked because
 * the twelfth failed" would be a second batch of API calls that can also
 * fail halfway. The undo record carries exactly the ids that moved, so the
 * undo is precise even when the archive was not complete.
 */
async function archiveMail(p: Proposal): Promise<Outcome> {
  const ids = Array.isArray(p.payload.ids) ? (p.payload.ids as string[]) : [];
  const who = String(p.payload.sender ?? "mail");
  if (!ids.length) return { ok: false, error: "The proposal lists no messages." };

  const moved: string[] = [];
  for (const id of ids) {
    try {
      await archiveGmail(id);
      moved.push(id);
    } catch (e) {
      // A missing scope is not a per-message failure — nothing will work, so
      // stop and say the one thing he can act on.
      if (e instanceof ScopeError) {
        return moved.length
          ? { ok: true, label: `${moved.length} of ${ids.length} from ${who}`, undo: { op: "mail.unarchive", ids: moved } }
          : { ok: false, error: e.message };
      }
    }
  }
  if (!moved.length) return { ok: false, error: "Gmail refused every message." };
  return {
    ok: true,
    label: moved.length === ids.length ? `${moved.length} from ${who}` : `${moved.length} of ${ids.length} from ${who}`,
    href: "/mail",
    undo: { op: "mail.unarchive", ids: moved },
  };
}

const RUN: Partial<Record<Proposal["kind"], (p: Proposal) => Promise<Outcome>>> = {
  "mail.archive": archiveMail,
  "expense.file": fileExpense,
  "task.create": createTask,
  "study.schedule": scheduleStudy,
};

/**
 * Run a proposal and record what happened.
 *
 * `auto` only changes the journal entry — whether it ran because he pressed
 * something or because he had standing permission for that kind. It is not
 * a second authorisation path: whoever calls this has already decided.
 */
export async function execute(p: Proposal, auto = false): Promise<Outcome> {
  const run = RUN[p.kind];
  if (!run) {
    const out: Outcome = { ok: false, error: `Nothing here knows how to do "${p.kind}" yet.` };
    await patchProposal(p.id, { status: "failed", error: out.error, decidedAt: new Date().toISOString(), auto });
    return out;
  }

  let out: Outcome;
  try {
    out = await run(p);
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  await patchProposal(p.id, {
    status: out.ok ? "done" : "failed",
    decidedAt: new Date().toISOString(),
    auto,
    ...(out.ok
      ? { result: { label: out.label ?? "done", href: out.href, undo: out.undo } }
      : { error: out.error }),
  });
  return out;
}

/**
 * Put it back.
 *
 * Only reachable for kinds declared reversible, and only using the undo
 * record written at the time. There is deliberately no generic "figure out
 * how to reverse this" path: a guess at how to undo something is how you
 * delete the wrong row.
 */
export async function undo(p: Proposal): Promise<Outcome> {
  if (!SAFETY[p.kind].reversible) return { ok: false, error: "This kind cannot be undone." };
  const rec = p.result?.undo as { op?: string; id?: string; ids?: string[] } | undefined;
  if (!rec?.op || (!rec.id && !rec.ids?.length)) {
    return { ok: false, error: "No undo record was written for this one." };
  }

  try {
    if (rec.op === "expense.delete" && rec.id) await deleteExpense(rec.id);
    else if (rec.op === "task.delete" && rec.id) await db.from("Task").delete().eq("userId", DEFAULT_USER_ID).eq("id", rec.id);
    else if (rec.op === "mail.unarchive" && rec.ids) {
      for (const id of rec.ids) await unarchiveGmail(id);
    }
    else return { ok: false, error: `Unknown undo operation "${rec.op}".` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  await patchProposal(p.id, { status: "dismissed", decidedAt: new Date().toISOString(), result: undefined });
  return { ok: true, label: "put back" };
}
