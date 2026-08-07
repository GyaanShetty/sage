import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { TZ } from "@/lib/config";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_SCOPES = [
  // full calendar events read/write so SAGE can add, edit, and remove events
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  // compose = create drafts (safe: nothing sends without you hitting Send)
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

export function appUrl(): string {
  const raw =
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return raw.replace(/\/+$/, "");
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
  id?: string;
  summary: string;
  start: string;
  end: string;
  allDay?: boolean;
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
      id?: string;
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }[];
  };
  return (json.items ?? []).map((e) => ({
    ...(e.id ? { id: e.id } : {}),
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: !e.start?.dateTime && !!e.start?.date,
    ...(e.location ? { location: e.location } : {}),
  }));
}

/**
 * Events in a window, not just the ones ahead.
 *
 * listUpcomingEvents answers "what is next", which is all a brief needs. A
 * calendar has to show the days already gone in the month you are looking at,
 * so it needs both ends of the range.
 */
export async function listEventsBetween(fromIso: string, toIso: string, maxResults = 250): Promise<CalendarEvent[] | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const params = new URLSearchParams({
    timeMin: fromIso,
    timeMax: toIso,
    maxResults: String(Math.min(2500, maxResults)),
    // Recurring events are expanded into their occurrences; without this a
    // weekly lecture appears once, on the day the series was created.
    singleEvents: "true",
    orderBy: "startTime",
  });
  const res = await proxyFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    items?: {
      id?: string; summary?: string; location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }[];
  };
  return (json.items ?? []).map((e) => ({
    ...(e.id ? { id: e.id } : {}),
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: !e.start?.dateTime && !!e.start?.date,
    ...(e.location ? { location: e.location } : {}),
  }));
}

/** Create a calendar event. `start`/`end` are ISO datetimes; if allDay, pass YYYY-MM-DD dates. */
export async function createCalendarEvent(input: { summary: string; start: string; end: string; allDay?: boolean; location?: string }): Promise<{ id: string } | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const body = {
    summary: input.summary,
    ...(input.location ? { location: input.location } : {}),
    start: input.allDay ? { date: input.start.slice(0, 10) } : { dateTime: input.start, timeZone: TZ },
    end: input.allDay ? { date: input.end.slice(0, 10) } : { dateTime: input.end, timeZone: TZ },
  };
  const res = await proxyFetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { id: string };
  return { id: j.id };
}

/** Update an existing event (PATCH — only supplied fields change). */
export async function updateCalendarEvent(id: string, input: { summary?: string; start?: string; end?: string; allDay?: boolean; location?: string }): Promise<boolean | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const body: Record<string, unknown> = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.location !== undefined) body.location = input.location;
  if (input.start) body.start = input.allDay ? { date: input.start.slice(0, 10) } : { dateTime: input.start, timeZone: TZ };
  if (input.end) body.end = input.allDay ? { date: input.end.slice(0, 10) } : { dateTime: input.end, timeZone: TZ };
  const res = await proxyFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/** Delete an event. */
export async function deleteCalendarEvent(id: string): Promise<boolean | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const res = await proxyFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  return res.ok || res.status === 410;
}

export interface EmailSummary {
  from: string;
  subject: string;
  snippet: string;
  id?: string;
  important?: boolean;
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
      labelIds?: string[];
      payload?: { headers?: { name: string; value: string }[] };
    };
    const header = (name: string) =>
      detail.payload?.headers?.find((h) => h.name === name)?.value ?? "";
    out.push({
      id: msg.id,
      from: header("From"),
      subject: header("Subject"),
      snippet: detail.snippet ?? "",
      important: detail.labelIds?.includes("IMPORTANT") ?? false,
    });
  }
  return out;
}

/**
 * One message, in full.
 *
 * Gmail returns the body base64url-encoded and, for anything modern, split
 * across a MIME tree with text/plain and text/html siblings. Plain text is
 * preferred where it exists; HTML is stripped rather than rendered, because a
 * mail body is untrusted markup and this is only ever read, summarised or
 * quoted — never displayed as live HTML.
 */
export interface EmailFull extends EmailSummary {
  to: string;
  date: string;
  body: string;
  labelIds: string[];
  unread: boolean;
  /** Everything the message carried besides its text. */
  attachments: Attachment[];
}

/**
 * A file on a message.
 *
 * `inline` separates the two kinds that look identical in the API and are not
 * the same thing to a reader: a signature logo or a tracking pixel is inline,
 * and listing those as attachments buries the one PDF that actually matters
 * under six 2 KB images.
 */
export interface Attachment {
  /** Gmail's attachment id — needed to fetch the bytes, and only valid with the message id. */
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
  isImage: boolean;
}

interface MimePart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: MimePart[];
}

/** Collect every real file hanging off a message, depth-first. */
export function collectAttachments(part: MimePart | undefined, out: Attachment[] = []): Attachment[] {
  if (!part) return out;

  if (part.body?.attachmentId && part.filename) {
    const disposition = part.headers?.find((h) => h.name.toLowerCase() === "content-disposition")?.value ?? "";
    const mimeType = part.mimeType ?? "application/octet-stream";
    out.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType,
      size: part.body.size ?? 0,
      inline: /inline/i.test(disposition),
      isImage: mimeType.startsWith("image/"),
    });
  }

  for (const p of part.parts ?? []) collectAttachments(p, out);
  return out;
}

function decodeB64Url(data: string): string {
  try {
    const norm = data.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(norm), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

/** Walk the MIME tree for the best readable body. */
function extractBody(part: MimePart | undefined): string {
  if (!part) return "";

  if (part.mimeType === "text/plain" && part.body?.data) return decodeB64Url(part.body.data);

  if (part.parts?.length) {
    // Prefer plain across the whole subtree before settling for HTML.
    for (const p of part.parts) {
      const plain = extractBody(p.mimeType?.startsWith("multipart") ? p : p.mimeType === "text/plain" ? p : undefined);
      if (plain) return plain;
    }
    for (const p of part.parts) {
      const any = extractBody(p);
      if (any) return any;
    }
  }

  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeB64Url(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return "";
}

export async function getGmailMessage(id: string): Promise<EmailFull | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const res = await proxyFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;

  const m = (await res.json()) as {
    snippet?: string; labelIds?: string[]; internalDate?: string;
    payload?: MimePart & { headers?: { name: string; value: string }[] };
  };
  const header = (name: string) =>
    m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

  return {
    id,
    from: header("From"),
    to: header("To"),
    subject: header("Subject"),
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : "",
    snippet: m.snippet ?? "",
    body: extractBody(m.payload).slice(0, 20_000),
    labelIds: m.labelIds ?? [],
    unread: (m.labelIds ?? []).includes("UNREAD"),
    important: (m.labelIds ?? []).includes("IMPORTANT"),
    attachments: collectAttachments(m.payload),
  };
}

/**
 * The bytes of one attachment.
 *
 * Gmail returns them base64url-encoded in JSON rather than as a file, and only
 * against the message they belong to — an attachment id alone is not a handle
 * on anything, which is a useful property: nothing here can be used to reach a
 * file the caller could not already open.
 */
export async function getGmailAttachment(
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const res = await proxyFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: string };
  if (!j.data) return null;
  try {
    const norm = j.data.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(norm), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * A page of messages with the metadata a list view needs.
 *
 * listUnreadEmails answers one narrow question; this one takes any Gmail query
 * and returns the date and read state too, which a mailbox cannot render
 * without.
 */
export async function listGmail(query: string, maxResults = 25): Promise<(EmailSummary & { date: string; unread: boolean })[] | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const listRes = await proxyFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) return null;
  const list = (await listRes.json()) as { messages?: { id: string }[] };

  // Gmail has no batch metadata endpoint on this API surface, so these are
  // fetched in parallel rather than in the sequential loop the older helpers
  // use — twenty-five round trips one after another is a visibly slow inbox.
  const details = await Promise.all(
    (list.messages ?? []).map(async (msg) => {
      const res = await proxyFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return null;
      const d = (await res.json()) as {
        snippet?: string; labelIds?: string[]; internalDate?: string;
        payload?: { headers?: { name: string; value: string }[] };
      };
      const header = (name: string) => d.payload?.headers?.find((h) => h.name === name)?.value ?? "";
      return {
        id: msg.id,
        from: header("From"),
        subject: header("Subject"),
        snippet: d.snippet ?? "",
        date: d.internalDate ? new Date(Number(d.internalDate)).toISOString() : "",
        unread: (d.labelIds ?? []).includes("UNREAD"),
        important: (d.labelIds ?? []).includes("IMPORTANT"),
      };
    }),
  );

  return details.filter((d): d is NonNullable<typeof d> => d !== null);
}

/** Search Gmail by query (e.g. "from:linkedin.com newer_than:7d"). */
export async function searchGmail(query: string, maxResults = 6): Promise<EmailSummary[] | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const listRes = await proxyFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) return null;
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const out: EmailSummary[] = [];
  for (const msg of list.messages ?? []) {
    const res = await proxyFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) continue;
    const detail = (await res.json()) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
    const header = (name: string) => detail.payload?.headers?.find((h) => h.name === name)?.value ?? "";
    out.push({ from: header("From"), subject: header("Subject"), snippet: detail.snippet ?? "" });
  }
  return out;
}

/** Send an email via Gmail (compose scope). Used for the weekly review the user asked SAGE to email. */
export async function sendGmail(to: string, subject: string, body: string): Promise<boolean | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await proxyFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  return res.ok;
}

/** Create a Gmail draft (does NOT send — the user reviews and sends it). */
export async function createGmailDraft(to: string, subject: string, body: string): Promise<boolean | null> {
  const token = await getGoogleAccessToken();
  if (!token) return null;
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await proxyFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { raw: encoded } }),
  });
  return res.ok;
}
