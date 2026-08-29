import { NextResponse } from "next/server";
import { exchangeOutlookCode, saveOutlookTokens } from "@/infrastructure/integrations/outlook";
import { appUrl } from "@/infrastructure/integrations/google";

/**
 * Where Microsoft sends him back.
 *
 * The path matters: it is registered in the Azure app, and must match byte for
 * byte or every sign-in fails with AADSTS50011 — an error that names nothing
 * useful, so it reads as a code bug rather than a configuration mismatch.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const back = (msg: string) => NextResponse.redirect(`${appUrl()}/settings?outlook=${encodeURIComponent(msg)}`);

  // Microsoft reports refusals in the querystring, not as an HTTP error. Its
  // own description is far more useful than anything we could invent.
  const err = q.get("error_description") ?? q.get("error");
  if (err) return back(err.slice(0, 200));

  const code = q.get("code");
  if (!code) return back("No authorisation code returned.");

  try {
    const tokens = await exchangeOutlookCode(code);
    if (!tokens.refresh_token) {
      // Worth saying out loud: without offline_access the connection works for
      // an hour and then dies, which presents as "Outlook broke" later.
      await saveOutlookTokens(tokens);
      return back("Connected, but Microsoft returned no refresh token — re-consent with offline_access.");
    }
    await saveOutlookTokens(tokens);
    return back("connected");
  } catch (e) {
    return back(String((e as Error)?.message ?? e).slice(0, 200));
  }
}
