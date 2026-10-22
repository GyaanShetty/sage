/**
 * Mail that has done its job.
 *
 * Newsletters are the bulk of an inbox and almost none of them need a
 * decision twice. This finds the ones that are read and more than a few
 * days old and proposes clearing them out.
 *
 * It proposes in BATCHES, one proposal per sender rather than per message.
 * Twenty rows saying "archive this newsletter" is the version of this
 * feature that gets switched off in a week; one row saying "archive 14 from
 * Substack, oldest 9 days" is a decision he can actually make.
 *
 * Archiving is classified outward even though it is reversible, so it is
 * never automatic. The mailbox is shared state — it is the same inbox open
 * on his phone — and a thing that quietly rearranges it while he is looking
 * at it is a thing he stops trusting.
 */

import { listGmail } from "@/infrastructure/integrations/google";
import { propose } from "../store";

/** The part of "Name <addr@host>" worth grouping by. */
function sender(from: string): string {
  const named = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named) return named[1].trim();
  return from.replace(/[<>]/g, "").split("@")[0] || from;
}

const DAYS = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);

export async function readNewsletters(): Promise<number> {
  /*
   * `category:promotions OR category:updates` plus `is:read` is Gmail's own
   * classification doing the hard part. Asking a model which mail is a
   * newsletter would be slower, cost tokens and be wrong more often than
   * Gmail, which has the sender reputation data.
   */
  const mail = await listGmail("is:read older_than:3d (category:promotions OR category:updates)", 60)
    .catch(() => null);
  if (!mail?.length) return 0;

  const bySender = new Map<string, { ids: string[]; oldest: string }>();
  for (const m of mail) {
    // No date means Gmail gave no internalDate, and "oldest" is the only
    // thing the proposal claims about the pile — so an undated message is
    // left out rather than making that claim unverifiable.
    if (!m.date || !m.id) continue;
    const key = sender(m.from);
    const cur = bySender.get(key) ?? { ids: [], oldest: m.date };
    cur.ids.push(m.id);
    if (m.date < cur.oldest) cur.oldest = m.date;
    bySender.set(key, cur);
  }

  let n = 0;
  // Biggest piles first, and only the piles worth a row of his attention.
  const ranked = [...bySender].sort((a, b) => b[1].ids.length - a[1].ids.length).slice(0, 4);
  for (const [name, g] of ranked) {
    if (g.ids.length < 3) continue;
    const age = DAYS(g.oldest);
    const id = await propose({
      kind: "mail.archive",
      title: `Archive ${g.ids.length} from ${name}`,
      why: `All read, oldest ${age} day${age === 1 ? "" : "s"} old. Archiving only removes them from the inbox — they stay in All Mail, and this can be undone.`,
      payload: { ids: g.ids, sender: name },
      /* Keyed on sender and count: if three more arrive and are read, that
         is a genuinely different pile and worth asking about again. */
      dedupe: `archive|${name.toLowerCase()}|${g.ids.length}`,
    });
    if (id) n++;
  }
  return n;
}
