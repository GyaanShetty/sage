/**
 * The opportunities in both mailboxes.
 *
 * Deliberately not folded into `GET /api/career`: that call is the board's
 * first paint and must not wait on two network mailboxes. This one is allowed
 * to be slow, because what it returns — forms that close, interviews to
 * accept — is worth waiting a second for.
 *
 * Each mailbox is caught independently. One unconnected connector must not
 * blank the other's findings, and the response says which of the two answered
 * so the page can name the missing one instead of showing a bare empty state.
 */

import { NextResponse } from "next/server";
import { findOpportunities, fromGmail, type MailLike, type Opportunity } from "@/core/career/inbox";
import { RECRUITING_QUERY } from "@/core/career/scan";
import { listGmail } from "@/infrastructure/integrations/google";
import { listOutlookMail } from "@/infrastructure/integrations/outlook";

export const dynamic = "force-dynamic";

export type Sourced = Opportunity & { source: "gmail" | "outlook" };

export async function GET() {
  const [gmail, outlook] = await Promise.all([
    listGmail(RECRUITING_QUERY, 25).catch(() => null),
    listOutlookMail(50).catch(() => null),
  ]);

  const tagged = new Map<string, "gmail" | "outlook">();
  const mail: MailLike[] = [];
  for (const m of gmail ?? []) {
    const like = fromGmail(m);
    tagged.set(like.id, "gmail");
    mail.push(like);
  }
  for (const m of outlook ?? []) {
    tagged.set(m.id, "outlook");
    mail.push(m);
  }

  const opportunities: Sourced[] = findOpportunities(mail)
    .slice(0, 12)
    .map((o) => ({ ...o, source: tagged.get(o.id) ?? "gmail" }));

  return NextResponse.json({
    ok: true,
    data: { opportunities, gmail: gmail !== null, outlook: outlook !== null },
  });
}
