/**
 * SAGE v2: the thing it wants to do.
 *
 * v1 is a wall you read. Every panel answers a question and then stops, and
 * the work — filing the receipt, booking the study block, turning the email
 * into a task — stays with Gyaan. v2's premise is that SAGE should do the
 * routine and show its working.
 *
 * The unit is a PROPOSAL rather than an action, and that choice is the whole
 * design. An assistant that simply acts is either trusted with everything or
 * trusted with nothing; there is no way to earn the middle. A proposal says
 * what it wants to do and why, carries its own safety classification, and
 * either waits to be approved or runs and leaves an undo. You can watch it
 * work for a week and then let it off the leash one kind at a time.
 *
 * Nothing here is clever. The value is entirely in the discipline:
 *
 *   · every proposal states a REASON, in the user's words, not the model's;
 *   · every proposal declares whether it can be undone and whether it leaves
 *     the machine;
 *   · anything that leaves the machine is never automatic, whatever the
 *     settings say;
 *   · every execution writes a journal entry, including the failures.
 */

/** What a proposal would do. One per effect SAGE knows how to produce. */
export type ProposalKind =
  | "expense.file"      // a receipt found in mail becomes a logged expense
  | "task.create"       // something read implies a directive
  | "study.schedule"    // a free gap becomes a study block
  | "mail.archive"      // a read newsletter leaves the inbox
  | "mail.draft";       // a thread that needs a reply gets one written

export type ProposalStatus = "proposed" | "done" | "dismissed" | "failed";

/**
 * How dangerous the effect is, declared by the kind rather than guessed at
 * the call site.
 *
 * `outward` is the one that matters. An expense filed wrongly is a row to
 * delete; an email sent wrongly cannot be recalled, and no confidence score
 * should be allowed to authorise one. So `outward` kinds require a human
 * press, permanently, regardless of configuration — the auto-approval
 * setting cannot reach them.
 */
export interface Safety {
  /** Can SAGE put this back exactly as it was? */
  reversible: boolean;
  /** Does the effect leave this machine — sent, posted, shared, paid? */
  outward: boolean;
}

export const SAFETY: Record<ProposalKind, Safety> = {
  "expense.file":   { reversible: true,  outward: false },
  "task.create":    { reversible: true,  outward: false },
  "study.schedule": { reversible: true,  outward: false },
  // Archiving is reversible — the mail moves back — but it touches the
  // mailbox, which is shared state with every other client he reads mail on.
  "mail.archive":   { reversible: true,  outward: true },
  // A draft is not a send. It is still outward: it appears in a mailbox he
  // shares with other people's expectations, and a draft he did not write
  // sitting under a thread is a thing he has to notice before replying.
  "mail.draft":     { reversible: true,  outward: true },
};

/** Human labels, so the UI never has to switch on a kind. */
export const KIND_LABEL: Record<ProposalKind, string> = {
  "expense.file": "File an expense",
  "task.create": "Add a directive",
  "study.schedule": "Book a study block",
  "mail.archive": "Archive mail",
  "mail.draft": "Draft a reply",
};

export interface Proposal {
  id: string;
  kind: ProposalKind;
  /** One line, in his language: "File ₹249 Blue Tokai to food". */
  title: string;
  /**
   * Why SAGE thinks so, in a sentence. Not optional, and not generated
   * prose: the producer states the evidence it actually used. A proposal
   * that cannot say why it exists is one you can only accept on faith,
   * which defeats the point of showing it at all.
   */
  why: string;
  /** Everything the executor needs. Shape is the kind's business. */
  payload: Record<string, unknown>;
  status: ProposalStatus;
  createdAt: string;
  decidedAt?: string;
  /** Set when status is "failed", so the journal can say what went wrong. */
  error?: string;
  /**
   * What was created, so it can be undone and so the journal links to the
   * thing rather than describing it.
   */
  result?: { label: string; href?: string; undo?: Record<string, unknown> };
  /** True when SAGE ran it without being asked. Shown in the journal. */
  auto?: boolean;
  /**
   * A stable key for "this is the same proposal as that one". Producers run
   * every few minutes; without this, the same receipt is proposed forty
   * times before lunch.
   */
  dedupe: string;
}

/** Which kinds may run without being asked. Outward kinds are not eligible. */
export interface AgencySettings {
  auto: Partial<Record<ProposalKind, boolean>>;
}

export function mayAutoRun(kind: ProposalKind, settings: AgencySettings): boolean {
  const s = SAFETY[kind];
  // Two gates, and the first cannot be configured away. This is deliberate:
  // the setting is a convenience, and a convenience must not be able to
  // authorise something irreversible or outward-facing.
  if (s.outward || !s.reversible) return false;
  return settings.auto[kind] === true;
}
