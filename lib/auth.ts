export const SESSION_COOKIE = "sage_session";

/**
 * Session tokens.
 *
 * The previous scheme was a bare HMAC of the password: the same string for
 * every session, on every device, forever. It never expired, so a cookie
 * captured once was permanent access, and the only way to revoke anything was
 * to change the password — which signs everything out *and* changes what you
 * have to type.
 *
 * A token is now `v2.<expiry>.<nonce>.<signature>`, where the signature covers
 * the expiry and the nonce. That buys three things the old one lacked: it ages
 * out on its own, every login is a distinct token, and the epoch below revokes
 * every outstanding session without touching the password.
 *
 * Edge-compatible throughout (Web Crypto, no Buffer) — the middleware runs on
 * the Edge runtime.
 */

const VERSION = "v2";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Key material: the password plus an optional epoch. Setting
 *  SAGE_SESSION_EPOCH to any new value invalidates every existing token. */
function secretFor(password: string): string {
  return `${password}::${process.env.SAGE_SESSION_EPOCH ?? "1"}`;
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  // btoa over the raw bytes, made URL-safe. Buffer does not exist on Edge.
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mint a fresh session token. Every call produces a different one. */
export async function issueToken(password: string): Promise<string> {
  const expiry = Date.now() + MAX_AGE_MS;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const payload = `${expiry}.${nonce}`;
  return `${VERSION}.${payload}.${await sign(secretFor(password), payload)}`;
}

/**
 * Verify a token. Rejects anything malformed, expired, or signed with a
 * different secret. Returns a plain boolean on purpose — a caller must not be
 * able to learn *why* a token failed.
 */
export async function verifyToken(token: string | undefined, password: string): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return false;

  const [, expiryRaw, nonce, sig] = parts;
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return false;
  // A token may not claim an expiry beyond the policy maximum, or one minted
  // with a far-future date would outlive the lifetime it is meant to obey.
  if (expiry > Date.now() + MAX_AGE_MS + 60_000) return false;
  if (!nonce || nonce.length < 16) return false;

  const expected = await sign(secretFor(password), `${expiryRaw}.${nonce}`);
  return timingSafeEqual(sig, expected);
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Shared by login and logout so the two cannot drift apart — a clear that
 *  misses a flag silently leaves the cookie in place. */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export const SESSION_MAX_AGE_SECONDS = Math.floor(MAX_AGE_MS / 1000);
