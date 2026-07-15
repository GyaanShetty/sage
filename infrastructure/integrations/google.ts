import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { proxyFetch } from "@/infrastructure/http/fetch";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

export function appUrl(): string {
  return (
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

export function googleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: `${appUrl()}/api/integrations/google/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await proxyFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: `${appUrl()}/api/integrations/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function saveGoogleTokens(tokens: TokenResponse) {
  await db.from("Integration").upsert(
    {
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      provider: "google",
      scopes: GOOGLE_SCOPES.split(" "),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      status: "active",
    },
    { onConflict: "userId,provider" },
  );
}

/** Valid access token, refreshing when within 2 minutes of expiry. */
export async function getGoogleAccessToken(): Promise<string | null> {
  const { data } = await db
    .from("Integration")
    .select("accessToken, refreshToken, expiresAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("provider", "google")
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;

  const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
  if (expiresAt - Date.now() > 2 * 60 * 1000) return data.accessToken as string;
  if (!data.refreshToken) return data.accessToken as string;

  const res = await proxyFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: data.refreshToken as string,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return data.accessToken as string;
  const refreshed = (await res.json()) as TokenResponse;
  await db
    .from("Integration")
    .update({
      accessToken: refreshed.access_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    })
    .eq("userId", DEFAULT_USER_ID)
    .eq("provider", "google");
  return refreshed.access_token;
}

// ── API helpers ──────────────────────────────────────────────

export interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location?: string;
}

export async function listUpcomingEvents(maxResults = 8): Promise<CalendarEvent[] | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const res = await proxyFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Calendar ${res.status}`);
  const json = (await res.json()) as {
    items?: {
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }[];
  };
  return (json.items ?? []).map((e) => ({
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    ...(e.location ? { location: e.location } : {}),
  }));
}

export interface EmailSummary {
  from: string;
  subject: string;
  snippet: string;
}

export async function listUnreadEmails(maxResults = 5): Promise<EmailSummary[] | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const listRes = await proxyFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread%20in:inbox&maxResults=${maxResults}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) throw new Error(`Gmail ${listRes.status}`);
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const out: EmailSummary[] = [];
  for (const msg of list.messages ?? []) {
    const res = await proxyFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) continue;
    const detail = (await res.json()) as {
      snippet?: string;
      payload?: { headers?: { name: string; value: string }[] };
    };
    const header = (name: string) =>
      detail.payload?.headers?.find((h) => h.name === name)?.value ?? "";
    out.push({ from: header("From"), subject: header("Subject"), snippet: detail.snippet ?? "" });
  }
  return out;
}
