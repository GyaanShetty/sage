import { NextResponse } from "next/server";
import { listUnreadEmails } from "@/infrastructure/integrations/google";

export const revalidate = 120;

/** Unread email summaries for the Morning Block Gmail step. */
export async function GET() {
  const emails = await listUnreadEmails(10).catch(() => null);
  return NextResponse.json({ ok: true, data: { emails, connected: emails !== null } });
}
