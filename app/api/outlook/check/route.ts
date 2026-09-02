import { NextResponse } from "next/server";
import { outlookAuthUrl, outlookCreds, outlookTenant, redirectUri } from "@/infrastructure/integrations/outlook";
import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Ask Microsoft whether this configuration would work, without signing in.
 *
 * Connecting has been a guessing game: the browser redirects, Microsoft shows
 * AADSTS700016, and the two values that could be wrong — the client ID and
 * the tenant — are only visible on a page he has to leave to check. This
 * requests the authorize URL server-side and reports what comes back, so the
 * error code arrives next to the two values it is about.
 *
 * The request deliberately does not follow redirects. A configuration that is
 * correct answers with a 302 to the Microsoft sign-in page, and that 302 is
 * the pass condition — following it would fetch a login form and tell us
 * nothing.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const creds = await outlookCreds();
  const tenant = await outlookTenant();

  if (!creds) {
    return NextResponse.json({
      ok: false,
      error: "Client ID or secret is not set.",
      data: { tenant, redirectUri: redirectUri() },
    });
  }

  const url = await outlookAuthUrl();
  if (!url) return NextResponse.json({ ok: false, error: "Couldn't build the sign-in URL." });

  try {
    const res = await proxyFetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });

    // A 302 to login.microsoftonline.com is the healthy answer.
    if (res.status >= 300 && res.status < 400) {
      return NextResponse.json({
        ok: true,
        data: { verdict: "Configuration accepted. Press Connect.", tenant, clientId: creds.id },
      });
    }

    // Microsoft renders the error into the HTML of a 200. The AADSTS code is
    // the useful half; the page around it is not.
    const body = await res.text();
    const code = /AADSTS\d+/.exec(body)?.[0] ?? null;
    const message = /AADSTS\d+:[^<"]{0,180}/.exec(body)?.[0] ?? null;

    return NextResponse.json({
      ok: false,
      error: message ?? `Microsoft answered ${res.status}.`,
      data: {
        code,
        tenant,
        clientId: creds.id,
        redirectUri: redirectUri(),
        // The codes that actually happen, and what each means — Microsoft's
        // own text names neither of the values that need comparing.
        hint:
          code === "AADSTS700016" ? "The app is not registered in this directory. Put the Azure Directory (tenant) ID into outlook_tenant."
          : code === "AADSTS50011" ? "The redirect URI above is not registered in Azure. Add it exactly."
          : code === "AADSTS7000215" ? "The client secret is wrong — paste the secret VALUE, not the secret ID."
          : null,
      },
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? `Couldn't reach Microsoft: ${err.message}` : "Couldn't reach Microsoft.",
    });
  }
}
