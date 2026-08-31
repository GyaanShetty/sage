import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Keys SAGE can be given without a deploy.
 *
 * Until now every API key lived in a Vercel environment variable, which means
 * replacing a dead one was: open the dashboard, edit the variable, trigger a
 * redeploy, wait. That is a poor answer to "the AI has stopped working", and
 * it is the sort of friction that ends with one exhausted key sitting there
 * for a week.
 *
 * Keys stored here are picked up on the next model call — no redeploy, no
 * dashboard. Environment variables still work and still take precedence in
 * spirit: this is additive, so nothing existing changes.
 *
 * ── On storing secrets in the database ─────────────────────────────────────
 *
 * A key in a table is a key that leaks with the table, so they are encrypted
 * at rest with AES-256-GCM under a secret that is *not* in the database —
 * KEY_SECRET, falling back to CRON_SECRET or SAGE_PASSWORD. A dump of the
 * Event table on its own is therefore useless, including the backup that now
 * leaves for GitHub every night, which is exactly the case that worried me.
 *
 * Nothing in this module ever returns a key to a browser. The API surfaces
 * tails only.
 */

const TYPE = "ops.apikeys";

/**
 * Providers whose keys can be managed this way.
 *
 * Microsoft is two entries rather than one because its OAuth app has both a
 * client id and a client secret, and only the secret is truly sensitive. They
 * are stored the same way regardless — the id is not a secret, but keeping the
 * pair together is what makes "paste these two and Outlook works" a single
 * action instead of one field here and one environment variable there.
 */
export const PROVIDERS = ["google", "tavily", "hevy", "alphavantage", "outlook_id", "outlook_secret", "outlook_tenant", "fmp"] as const;
export type Provider = (typeof PROVIDERS)[number];

interface StoredKey {
  id: string;
  provider: Provider;
  /** AES-256-GCM, base64 of iv|tag|ciphertext. */
  sealed: string;
  tail: string;
  label?: string | null;
  addedAt: string;
}

function secret(): string | null {
  return process.env.KEY_SECRET || process.env.CRON_SECRET || process.env.SAGE_PASSWORD || null;
}

/**
 * A fixed salt, deliberately.
 *
 * A random per-key salt would be stored beside the ciphertext and bought
 * nothing here: there is one secret, one user, and the threat being defended
 * against is a leaked database, not an offline attack on a password file.
 * What matters is that the secret lives outside the database.
 */
const SALT = "sage.apikeys.v1";

function derive(): Buffer {
  const s = secret();
  if (!s) throw new Error("No KEY_SECRET (or CRON_SECRET / SAGE_PASSWORD) set — refusing to store a key unencrypted.");
  return scryptSync(s, SALT, 32);
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function unseal(sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, "base64");
    const decipher = createDecipheriv("aes-256-gcm", derive(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    // Wrong secret, or a tampered row. Either way this is not a usable key,
    // and throwing here would take down every model call at once.
    return null;
  }
}

export function keyStorageAvailable(): boolean {
  return secret() !== null;
}

async function readAll(): Promise<StoredKey[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: true }).limit(50);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<StoredKey, "id">) }));
}

/** Usable keys for a provider, decrypted. Server-side callers only. */
export async function keysFor(provider: Provider): Promise<string[]> {
  if (!keyStorageAvailable()) return [];
  const rows = await readAll().catch(() => []);
  return rows
    .filter((r) => r.provider === provider)
    .map((r) => unseal(r.sealed))
    .filter((k): k is string => !!k);
}

export interface KeyListing {
  id: string;
  provider: Provider;
  tail: string;
  label: string | null;
  addedAt: string;
  /** False when the stored secret can no longer decrypt it — KEY_SECRET changed. */
  readable: boolean;
}

/** What the UI is allowed to see: never a key, only its last four. */
export async function listKeys(): Promise<KeyListing[]> {
  const rows = await readAll().catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    tail: r.tail,
    label: r.label ?? null,
    addedAt: r.addedAt,
    readable: keyStorageAvailable() && unseal(r.sealed) !== null,
  }));
}

export async function addKey(provider: Provider, key: string, label?: string): Promise<{ ok: true; tail: string } | { ok: false; error: string }> {
  const clean = key.trim();
  if (!clean) return { ok: false, error: "That's empty." };
  if (!PROVIDERS.includes(provider)) return { ok: false, error: "Unknown provider." };
  if (!keyStorageAvailable()) {
    return { ok: false, error: "Set KEY_SECRET in the environment first — SAGE won't store a key it can't encrypt." };
  }
  // Not validation of the key itself, just a guard against a paste that went
  // wrong: a stored blank or a stray "Bearer " prefix fails silently later.
  if (clean.length < 12 || /\s/.test(clean)) {
    return { ok: false, error: "That doesn't look like a key — check the paste." };
  }

  const existing = await keysFor(provider);
  if (existing.includes(clean)) return { ok: false, error: "That key is already stored." };

  await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE,
    payload: {
      provider,
      sealed: seal(clean),
      tail: clean.slice(-4),
      label: label?.trim().slice(0, 40) ?? null,
      addedAt: new Date().toISOString(),
    },
  });

  return { ok: true, tail: clean.slice(-4) };
}

export async function removeKey(id: string): Promise<void> {
  await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID).eq("type", TYPE);
}
