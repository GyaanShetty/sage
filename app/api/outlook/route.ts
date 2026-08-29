import { NextResponse } from "next/server";
import { outlookAuthUrl, credsStatus, outlookIdentity, redirectUri } from "@/infrastructure/integrations/outlook";

/** GET → connection status. POST → begin the OAuth dance. */
export const dynamic = "force-dynamic";

export async function GET() {
  const [creds, identity] = await Promise.all([credsStatus(), outlookIdentity().catch(() => null)]);
  return NextResponse.json({
    ok: true,
    data: {
      ...creds,
      connected: !!identity,
      identity,
      // Shown in settings so a redirect-URI mismatch is a two-second diagnosis
      // rather than a hunt through Azure. AADSTS50011 says almost nothing.
      redirectUri: redirectUri(),
    },
  });
}

export async function POST() {
  const url = await outlookAuthUrl();
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "Outlook client ID and secret are not set in Settings." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, data: { url } });
}
