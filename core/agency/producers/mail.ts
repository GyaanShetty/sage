/**
 * Mail that is asking him for something.
 *
 * Most of an inbox is not work. The producer's job is not to summarise mail
 * — the inbox pane already shows it — but to find the small number of
 * threads that imply an action he has not recorded anywhere, and turn those
 * into directives he can tick off.
 *
 * The hard part is restraint. A model asked "what should I do about this
 * inbox" will cheerfully return twenty tasks, and twenty tasks a morning is
 * a list he stops reading by Thursday. So: unread only, a hard cap, and a
 * prompt that is mostly instructions about what NOT to propose.
 */

import { z } from "zod";
import { generateObject } from "ai";
import { getModel } from "@/infrastructure/llm";
import { listGmail } from "@/infrastructure/integrations/google";
import { propose } from "../store";

const schema = z.object({
  actions: z.array(z.object({
    /** The directive, in the imperative, as he would write it himself. */
    title: z.string().describe("A short imperative task, e.g. 'Reply to PES about the screening'"),
    /** Which message it came from, so the proposal can cite it. */
    from: z.string().describe("The sender's name, copied from the email"),
    subject: z.string().describe("The subject line, copied verbatim"),
    /** Why this is a real action rather than something to read. */
    because: z.string().describe("One short clause: what the email actually asks for"),
  })).max(4),
});

const SYSTEM = `You find the few emails that genuinely ask the reader to DO something, and ignore the rest.

Propose a task ONLY when the email requires an action from the reader that would otherwise be forgotten:
a reply someone is waiting on, a form to submit, a payment due, an appointment to confirm, a deadline.

Never propose a task for:
 · newsletters, digests, promotions, sales, or "you might like" mail
 · notifications from software (build failures, CI, deploys, alerts, social)
 · receipts and confirmations of things already done
 · anything that is purely information to read
 · anything where the action is "read this"

Fewer is better. Returning nothing is the correct answer for most inboxes.
Never invent urgency. Copy the sender and subject verbatim.`;

export async function mailDirectives(): Promise<number> {
  const model = getModel("smart");
  if (!model) return 0;

  /* Unread only, and recent. An old unread mail he has consciously left
     alone is not a task he forgot — proposing it is second-guessing a
     decision he already made. */
  const mail = await listGmail("is:unread newer_than:7d -category:promotions -category:social", 25)
    .catch(() => null);
  if (!mail?.length) return 0;

  const { object } = await generateObject({
    model, schema, system: SYSTEM,
    prompt: mail.map((m, i) => `${i + 1}. From ${m.from} — ${m.subject}: ${m.snippet}`).join("\n"),
  }).catch(() => ({ object: { actions: [] } }));

  let n = 0;
  for (const a of object.actions) {
    const title = a.title.trim();
    if (!title) continue;
    /*
     * Cited, not paraphrased. The reason names the actual sender and
     * subject so he can find the email in two seconds and judge whether
     * the model read it right — which is the only way a proposal from a
     * model is worth more than the model's own confidence.
     */
    const id = await propose({
      kind: "task.create",
      title,
      why: `${a.from} — "${a.subject}". ${a.because}`,
      payload: { title, priority: 2 },
      // The subject is the stable part; a thread re-read tomorrow must not
      // become a second identical directive.
      dedupe: `mail-task|${a.subject.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80)}`,
    });
    if (id) n++;
  }
  return n;
}
