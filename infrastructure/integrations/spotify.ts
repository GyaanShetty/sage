import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { appUrl } from "./google";

const AUTH = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing";

function redirectUri() {
  return `${appUrl()}/api/integrations/spotify/callback`;
}
function basicAuth() {
  return Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
}

export function spotifyAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
  });
  return `${AUTH}?${params}`;
}

interface TokenResp { access_token: string; refresh_token?: string; expires_in: number }

export async function exchangeSpotifyCode(code: string): Promise<TokenResp> {
  const res = await proxyFetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basicAuth()}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }),
  });
  if (!res.ok) throw new Error(`Spotify token: ${await res.text()}`);
  return (await res.json()) as TokenResp;
}

export async function saveSpotifyTokens(t: TokenResp) {
  await db.from("Integration").upsert(
    {
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      provider: "spotify",
      scopes: SCOPES.split(" "),
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      status: "active",
    },
    { onConflict: "userId,provider" },
  );
}

async function accessToken(): Promise<string | null> {
  const { data } = await db
    .from("Integration")
    .select("accessToken, refreshToken, expiresAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("provider", "spotify")
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  const exp = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
  if (exp - Date.now() > 60_000) return data.accessToken as string;
  if (!data.refreshToken) return data.accessToken as string;
  const res = await proxyFetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basicAuth()}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: data.refreshToken as string }),
  });
  if (!res.ok) return data.accessToken as string;
  const t = (await res.json()) as TokenResp;
  await db.from("Integration").update({
    accessToken: t.access_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  }).eq("userId", DEFAULT_USER_ID).eq("provider", "spotify");
  return t.access_token;
}

export interface NowPlaying { playing: boolean; track: string; artist: string; art: string | null; progress: number; duration: number }

export async function getNowPlaying(): Promise<NowPlaying | null> {
  const token = await accessToken();
  if (!token) return null;
  const res = await proxyFetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 204 || !res.ok) return { playing: false, track: "", artist: "", art: null, progress: 0, duration: 0 };
  const j = (await res.json()) as {
    is_playing: boolean;
    progress_ms: number;
    item: { name: string; duration_ms: number; artists: { name: string }[]; album: { images: { url: string }[] } };
  };
  return {
    playing: j.is_playing,
    track: j.item?.name ?? "",
    artist: (j.item?.artists ?? []).map((a) => a.name).join(", "),
    art: j.item?.album?.images?.[j.item.album.images.length - 1]?.url ?? null,
    progress: j.progress_ms ?? 0,
    duration: j.item?.duration_ms ?? 0,
  };
}

export async function spotifyControl(action: "play" | "pause" | "next" | "previous"): Promise<boolean | null> {
  const token = await accessToken();
  if (!token) return null;
  const method = action === "next" || action === "previous" ? "POST" : "PUT";
  const path = action === "play" ? "play" : action === "pause" ? "pause" : action;
  const res = await proxyFetch(`https://api.spotify.com/v1/me/player/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
  return res.ok || res.status === 204;
}

/** Play a named playlist/track by searching, then starting it. */
export async function spotifyPlaySearch(query: string): Promise<boolean | null> {
  const token = await accessToken();
  if (!token) return null;
  const res = await proxyFetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=playlist,track&limit=1`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return false;
  const j = (await res.json()) as {
    playlists?: { items: { uri: string }[] };
    tracks?: { items: { uri: string }[] };
  };
  const uri = j.playlists?.items?.[0]?.uri;
  const trackUri = j.tracks?.items?.[0]?.uri;
  const body = uri ? { context_uri: uri } : trackUri ? { uris: [trackUri] } : null;
  if (!body) return false;
  const play = await proxyFetch("https://api.spotify.com/v1/me/player/play", {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return play.ok || play.status === 204;
}
