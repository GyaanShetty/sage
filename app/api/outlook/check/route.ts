import { NextResponse } from "next/server";
import { outlookAuthUrl, outlookCreds, outlookTenant, redirectUri } from "@/infrastructure/integrations/outlook";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { addKey } from "@/core/ops/keys";

/**
 * Find the authority that actually works, rather than asking him to guess.
 *
 * Connecting Outlook has failed twice with AADSTS700016 — "Application with
 * identifier X was not found in the directory Y". That message reads like a
 * bad client ID and almost never is one: Y is the directory the request was
 * sent to, and the app is registered in a different one. The two GUIDs that
 * need comparing are on a page he has to leave SAGE to read, which is why
 * this has been a guessing game.
 *
 * So SAGE guesses instead, and verifies. It asks Microsoft for the authorize
 * URL under each plausible authority and reports which one is accepted:
 *
 * - the tenant currently configured,
 * - `common` — any work, school or personal account,
 * - `organizations` — any work or school account,
 * - `consumers` — personal Microsoft accounts only.
 *
 * A configuration that works answers with a 302 to the sign-in page. That 302
 * is the pass condition, and redirects are deliberately not followed —
 * following one fetches a login form and tells us nothing.
 *
 * When exactly one authority passes, it is saved, because the alternative is
 * showing him a GUID and asking him to copy it into a box two lines below.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 45;

interface Probe {
  tenant: string;
  label: string;
  ok: boolean;
  code: string | null;
  message: string | null;
}

const LABELS: Record<string, string> = {
  common: "Any account (common)",
  organizations: "Work or school (organizations)",
  consumers: "Personal Microsoft account (consumers)",
};

async function probe(tenant: string): Promise<Probe> {
  const label = LABELS[tenant] ?? `Tenant ${tenant.slice(0, 8)}…`;
  const url = await outlookAuthUrl(tenant);
  if (!url) return { tenant, label, ok: false, code: null, message: "No client ID or secret." };

  try {
    const res = await proxyFetch(url, { redirect: "manual", signal: AbortSignal.timeout(12_000) });
    if (res.status >= 300 && res.status < 400) return { tenant, label, ok: true, code: null, message: null };

    // Microsoft renders the failure into the HTML of a 200. The AADSTS code is
    // the useful half; the page around it is not.
    const body = await res.text();
    return {
      tenant, label, ok: false,
      code: /AADSTS\d+/.exec(body)?.[0] ?? null,
      message: /AADSTS\d+:[^<"]{0,200}/.exec(body)?.[0] ?? `Microsoft answered ${res.status}.`,
    };
  } catch (err) {
    return {
      tenant, label, ok: false, code: null,
      message: err instanceof Error ? `Couldn't reach Microsoft: ${err.message}` : "Couldn't reach Microsoft.",
    };
  }
}

/** What a given AADSTS code actually means, in terms of the two values involved. */
function hintFor(code: string | null): string | null {
  switch (code) {
    case "AADSTS700016":
      return "The app registration does not exist in that directory. Open the app in Azure → Overview: the Directory (tenant) ID shown *there* is the one to use. If you want it to work for any account, set Supported account types to multi-tenant and use `common`.";
    case "AADSTS50011":
      return "The redirect URI is not registered in Azure. Add it exactly as shown, including the scheme and with no trailing slash.";
    case "AADSTS7000215":
      return "The client secret is wrong — paste the secret VALUE, not the Secret ID. The value is only shown once, when the secret is created.";
    case "AADSTS650053":
      return "A requested scope is not configured. Add Mail.Read, User.Read and offline_access under API permissions.";
    case "AADSTS900023":
      return "That tenant identifier is not a real directory. It must be a GUID, a verified domain, or one of common / organizations / consumers.";
    default:
      return null;
  }
}

export async function POST() {
  const creds = await outlookCreds();
  const configured = await outlookTenant();

  if (!creds) {
    return NextResponse.json({
      ok: false,
      error: "Client ID or secret is not set.",
      data: { tenant: configured, redirectUri: redirectUri() },
    });
  }

  // The configured tenant first, then the three well-known authorities —
  // deduped, so a configured value of "common" is not probed twice.
  const candidates = [...new Set([configured, "common", "organizations", "consumers"])];
  const probes: Probe[] = [];
  for (const t of candidates) probes.push(await probe(t));

  const working = probes.filter((p) => p.ok);
  const configuredProbe = probes.find((p) => p.tenant === configured)!;

  // Already fine: say so and change nothing.
  if (configuredProbe.ok) {
    return NextResponse.json({
      ok: true,
      data: {
        verdict: "Configuration accepted. Press Connect.",
        tenant: configured, clientId: creds.id, redirectUri: redirectUri(), probes,
      },
    });
  }

  // Exactly one alternative works — adopt it rather than describing it.
  if (working.length >= 1) {
    const pick = working[0];
    const res = await addKey("outlook_tenant", pick.tenant, "found by Check").catch(() => ({ ok: false as const, error: "write failed" }));
    const saved = res.ok;
    return NextResponse.json({
      ok: saved,
      data: {
        verdict: saved
          ? `Fixed: "${pick.label}" works, and SAGE has saved it. Press Connect.`
          : `"${pick.label}" works, but SAGE could not save it — set outlook_tenant to ${pick.tenant}.`,
        tenant: pick.tenant, clientId: creds.id, redirectUri: redirectUri(), probes,
      },
      ...(saved ? {} : { error: "Could not write the key." }),
    });
  }

  // Nothing works: the fault is the client ID, the secret or the redirect URI,
  // and the code says which.
  return NextResponse.json({
    ok: false,
    error: configuredProbe.message ?? "No authority accepted this app.",
    data: {
      code: configuredProbe.code,
      tenant: configured,
      clientId: creds.id,
      redirectUri: redirectUri(),
      hint: hintFor(configuredProbe.code),
      probes,
    },
  });
}
