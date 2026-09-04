import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { keysFor } from "@/core/ops/keys";
import { appUrl } from "./google";

/**
 * Outlook, via Microsoft Graph.
 *
 * Deliberately the same shape as google.ts — authorize, exchange, save, refresh
 * — because two OAuth integrations that differ in structure end up differing in
 * behaviour, and the second one is always the one with the subtle bug.
 *
 * Tokens go into the existing `Integration` table under provider "outlook", so
 * there is no migration and the generic disconnect route already works.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * Which directory to sign in against.
 *
 * `common` lets Microsoft pick, which resolves to the tenant the browser is
 * already signed into. That is right until the app registration lives
 * somewhere else — and then sign-in fails with AADSTS700016, "application with
 * identifier X was not found in the directory Y", which reads like a bad
 * client ID and is usually not one. Y in that message is the tenant the
 * request was sent to; the app is registered in a different one.
 *
 * So the tenant is configurable. Paste the Directory (tenant) ID from the
 * app registration's Overview page into the `outlook_tenant` slot and the
 * request goes to that directory instead of being guessed.
 */
export async function outlookTenant(): Promise<string> {
  const t = await keysFor("outlook_tenant").catch(() => [] as string[]);
  return (t[t.length - 1] ?? process.env.OUTLOOK_TENANT_ID ?? "common").trim();
}

const authority = (tenant: string, leaf: "authorize" | "token") =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/${leaf}`;

/**
 * `offline_access` is the one that matters.
 *
 * Without it Microsoft issues an access token and no refresh token, so the
 * connection works for an hour and then silently stops — which presents as
 * "Outlook broke" rather than "Outlook was never fully authorised".
 */
export const OUTLOOK_SCOPES = ["offline_access", "User.Read", "Mail.Read"].join(" ");

/**
 * The redirect URI is registered in Azure and must match byte for byte.
 *
 * This sits at /api/outlook/callback rather than following the
 * /api/integrations/<name>/callback convention used by Google, because that is
 * the URI already registered in the Azure app. Changing it to match the
 * convention would fail every sign-in with AADSTS50011 and look like a code
 * bug rather than a configuration mismatch.
 */
export function redirectUri(): string {
  return `${appUrl()}/api/outlook/callback`;
}

export interface OutlookCreds { id: string; secret: string }

/**
 * Credentials: the key store first, the environment second.
 *
 * The store is where he pasted them and takes effect with no redeploy, which
 * is the whole point of it. Environment variables still work for anyone who
 * prefers them, and are the fallback rather than the primary so that pasting a
 * replacement actually replaces.
 */
export async function outlookCreds(): Promise<OutlookCreds | null> {
  const [ids, secrets] = await Promise.all([
    keysFor("outlook_id").catch(() => [] as string[]),
    keysFor("outlook_secret").catch(() => [] as string[]),
  ]);
  const id = ids[ids.length - 1] ?? process.env.OUTLOOK_CLIENT_ID;
  const secret = secrets[secrets.length - 1] ?? process.env.OUTLOOK_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/** Which half is missing, so settings can say so instead of "not connected". */
export async function credsStatus(): Promise<{
  hasId: boolean; hasSecret: boolean; clientId: string | null; tenant: string;
}> {
  const [ids, secrets] = await Promise.all([
    keysFor("outlook_id").catch(() => [] as string[]),
    keysFor("outlook_secret").catch(() => [] as string[]),
  ]);
  const id = ids[ids.length - 1] ?? process.env.OUTLOOK_CLIENT_ID ?? null;
  return {
    hasId: ids.length > 0 || !!process.env.OUTLOOK_CLIENT_ID,
    hasSecret: secrets.length > 0 || !!process.env.OUTLOOK_CLIENT_SECRET,
    // The client ID is not a secret — it is in every authorize URL — and
    // showing it is the fastest way to catch the paste that went wrong.
    clientId: id,
    tenant: await outlookTenant(),
  };
}

export async function outlookAuthUrl(tenantOverride?: string): Promise<string | null> {
  const creds = await outlookCreds();
  if (!creds) return null;
  const params = new URLSearchParams({
    client_id: creds.id,
    redirect_uri: redirectUri(),
    response_type: "code",
    response_mode: "query",
    scope: OUTLOOK_SCOPES,
    // Force the consent screen so a re-connect after a scope change actually
    // re-consents rather than silently reusing the old, narrower grant.
    prompt: "consent",
  });
  return `${authority(tenantOverride ?? (await outlookTenant()), "authorize")}?${params}`;
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number }

export async function exchangeOutlookCode(code: string): Promise<TokenResponse> {
  const creds = await outlookCreds();
  if (!creds) throw new Error("Outlook client ID and secret are not set.");
  const res = await proxyFetch(authority(await outlookTenant(), "token"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.id,
      client_secret: creds.secret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      scope: OUTLOOK_SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as TokenResponse;
}

export async function saveOutlookTokens(tokens: TokenResponse): Promise<void> {
  await db.from("Integration").upsert(
    {
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      provider: "outlook",
      scopes: OUTLOOK_SCOPES.split(" "),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      status: "active",
    },
    { onConflict: "userId,provider" },
  );
}

/** Valid access token, refreshing when within two minutes of expiry. */
export async function getOutlookAccessToken(): Promise<string | null> {
  const { data } = await db
    .from("Integration")
    .select("accessToken, refreshToken, expiresAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("provider", "outlook")
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;

  const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
  if (expiresAt - Date.now() > 2 * 60 * 1000) return data.accessToken as string;
  if (!data.refreshToken) return data.accessToken as string;

  const creds = await outlookCreds();
  if (!creds) return data.accessToken as string;

  const res = await proxyFetch(authority(await outlookTenant(), "token"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: data.refreshToken as string,
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: "refresh_token",
      scope: OUTLOOK_SCOPES,
    }),
  });
  // A failed refresh returns the old token rather than null: it may still have
  // seconds left, and returning null would present a transient network blip as
  // "Outlook is disconnected".
  if (!res.ok) return data.accessToken as string;

  const refreshed = (await res.json()) as TokenResponse;
  await db
    .from("Integration")
    .update({
      accessToken: refreshed.access_token,
      // Microsoft rotates refresh tokens; keeping the old one would work until
      // it did not.
      ...(refreshed.refresh_token ? { refreshToken: refreshed.refresh_token } : {}),
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq("userId", DEFAULT_USER_ID)
    .eq("provider", "outlook");
  return refreshed.access_token;
}

export interface OutlookMessage {
  id: string;
  subject: string;
  from: string;
  fromName: string;
  preview: string;
  receivedAt: string;
  unread: boolean;
  webLink?: string;
  body?: string;
}

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime: string;
  isRead?: boolean;
  webLink?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  body?: { content?: string; contentType?: string };
}

function toMessage(m: GraphMessage): OutlookMessage {
  return {
    id: m.id,
    subject: m.subject ?? "(no subject)",
    from: m.from?.emailAddress?.address ?? "",
    fromName: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? "",
    preview: m.bodyPreview ?? "",
    receivedAt: m.receivedDateTime,
    unread: m.isRead === false,
    webLink: m.webLink,
    body: m.body?.content,
  };
}

export async function listOutlookMail(limit = 25): Promise<OutlookMessage[] | null> {
  const token = await getOutlookAccessToken();
  if (!token) return null;
  const url =
    `${GRAPH}/me/messages?$top=${Math.min(limit, 50)}` +
    `&$select=id,subject,bodyPreview,receivedDateTime,isRead,webLink,from` +
    `&$orderby=receivedDateTime desc`;
  const res = await proxyFetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const j = (await res.json()) as { value?: GraphMessage[] };
  return (j.value ?? []).map(toMessage);
}

/** One message, body included — for the reader and for extraction. */
export async function readOutlookMail(id: string): Promise<OutlookMessage | null> {
  const token = await getOutlookAccessToken();
  if (!token) return null;
  const res = await proxyFetch(`${GRAPH}/me/messages/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return toMessage((await res.json()) as GraphMessage);
}

export async function outlookIdentity(): Promise<string | null> {
  const token = await getOutlookAccessToken();
  if (!token) return null;
  const res = await proxyFetch(`${GRAPH}/me?$select=userPrincipalName,mail`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return j.mail ?? j.userPrincipalName ?? null;
}
