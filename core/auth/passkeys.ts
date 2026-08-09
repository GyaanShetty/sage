import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { APP_NAME } from "@/lib/config";

/**
 * Passkeys — Face ID, Touch ID, a hardware key.
 *
 * A password is a shared secret: it exists in your head, in the environment,
 * in whatever typed it last, and it can be handed to a convincing login page
 * by mistake. A passkey cannot. The private half never leaves the device's
 * secure element, the signature is bound to this exact origin by the browser
 * itself, and there is nothing to phish — a fake sage-os.example simply cannot
 * ask for a credential registered to the real one.
 *
 * That is the whole reason this is worth the code: it removes the attack that
 * actually happens to people, rather than the ones that are fun to imagine.
 *
 * ── What this does not do ─────────────────────────────────────────────────
 *
 * The password stays. It is what signs session tokens, it is the recovery
 * path when a phone is lost, and locking the only door behind a single device
 * is how people lose access to their own data. Passkeys are the front door;
 * the password is the key under no mat, in the environment, that you hope
 * never to need.
 */

const TYPE = "auth.passkey";

export interface StoredPasskey {
  /** Base64URL credential id, as the browser reports it. */
  id: string;
  /** Base64URL of the COSE public key. Public by definition — safe at rest. */
  publicKey: string;
  /**
   * The authenticator's signature counter.
   *
   * Kept because a counter that goes backwards means the credential has been
   * cloned. Many modern authenticators always report zero and the check is
   * then meaningless, which is exactly why it is recorded rather than trusted.
   */
  counter: number;
  transports?: string[];
  label: string;
  at: string;
  lastUsedAt?: string | null;
}

export async function listPasskeys(): Promise<StoredPasskey[]> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: false }).limit(50);
  return (data ?? []).map((r) => r.payload as StoredPasskey).filter((p) => p?.id);
}

export async function savePasskey(p: StoredPasskey): Promise<void> {
  const { error } = await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE, payload: p,
  });
  if (error) throw new Error(error.message);
}

/** Bump the counter and stamp the use, so a lost device can be spotted. */
export async function touchPasskey(id: string, counter: number): Promise<void> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE).eq("payload->>id", id).maybeSingle();
  if (!data) return;
  await db.from("Event")
    .update({ payload: { ...(data.payload as StoredPasskey), counter, lastUsedAt: new Date().toISOString() } })
    .eq("id", data.id);
}

export async function deletePasskey(id: string): Promise<void> {
  const { data } = await db
    .from("Event").select("id")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE).eq("payload->>id", id).maybeSingle();
  if (!data) return;
  const { trashRow } = await import("@/core/ops/trash");
  await trashRow("Event", data.id as string);
}

/**
 * Which origin a credential is bound to.
 *
 * Taken from APP_URL when it is set, and only from the Host header otherwise.
 * That order matters: a request's Host is attacker-controlled, and deriving
 * the relying party from it would let someone register a credential against a
 * hostname of their choosing. In production APP_URL should always be set.
 */
export function relyingParty(req: Request): { rpID: string; origin: string } {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      return { rpID: url.hostname, origin: url.origin };
    } catch {
      /* malformed — fall through to the header */
    }
  }
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return { rpID: host.split(":")[0], origin: `${proto}://${host}` };
}

export const RP_NAME = APP_NAME;

/**
 * The challenge cookie.
 *
 * A challenge has to survive the round trip between "give me options" and
 * "here is the signed response", and it must not be reusable. A short-lived
 * httpOnly cookie does both without a database write on a path that has to
 * work before the user is authenticated at all.
 */
export const CHALLENGE_COOKIE = "sage_pk_challenge";
export const CHALLENGE_MAX_AGE = 300; // five minutes: long enough for Face ID

export const CHALLENGE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Strict, not Lax: nothing legitimate arrives at these endpoints from
  // another site, and the challenge is the one value worth being strict about.
  sameSite: "strict" as const,
  path: "/",
  maxAge: CHALLENGE_MAX_AGE,
};
