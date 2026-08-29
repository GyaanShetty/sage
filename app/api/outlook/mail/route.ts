import { NextResponse } from "next/server";
import { listOutlookMail, readOutlookMail } from "@/infrastructure/integrations/outlook";
import { findOpportunities } from "@/core/career/inbox";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;

  const id = q.get("id");
  if (id) {
    const msg = await readOutlookMail(id);
    return msg
      ? NextResponse.json({ ok: true, data: msg })
      : NextResponse.json({ ok: false, error: "not found or not connected" }, { status: 404 });
  }

  const mail = await listOutlookMail(Number(q.get("limit") ?? 25));
  if (!mail) return NextResponse.json({ ok: false, error: "Outlook not connected" }, { status: 200 });

  // The opportunities view is the reason this integration exists, so it is
  // computed here rather than left to each caller to remember.
  return NextResponse.json({
    ok: true,
    data: { mail, opportunities: q.get("opportunities") === "0" ? [] : findOpportunities(mail) },
  });
}
