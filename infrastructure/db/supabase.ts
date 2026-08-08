import { createClient } from "@supabase/supabase-js";
import { fetch as undiciFetch, EnvHttpProxyAgent } from "undici";

// In proxied dev environments Next's bundled fetch bypasses HTTPS_PROXY;
// hand supabase-js an explicitly proxy-aware fetch. No-op in production.
const proxyAgent = process.env.HTTPS_PROXY || process.env.https_proxy ? new EnvHttpProxyAgent() : null;
const customFetch = proxyAgent
  ? ((((url: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
      undiciFetch(url, { ...init, dispatcher: proxyAgent })) as unknown) as typeof globalThis.fetch)
  : undefined;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Whether this process has a database to talk to at all. */
export const dbConfigured = !!url && !!key;

if (!dbConfigured && process.env.NODE_ENV !== "test") {
  // Loud, once, and actionable — rather than a stack trace from inside a
  // dependency that names an internal variable and nothing else.
  console.warn(
    "[db] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. " +
      "Nothing that touches the database will work. Copy env.example to .env.local, " +
      "or open /api/preflight for the full list of what is missing.",
  );
}

/**
 * Server-side data access over HTTPS (PostgREST). Prisma remains the
 * schema/migration source of truth; runtime queries go through Supabase
 * so the app works in HTTPS-only environments too.
 *
 * ── Why the placeholder ────────────────────────────────────────────────────
 *
 * createClient throws on a missing URL, and it throws *at import time*. Since
 * most of core/ imports this transitively, that turned "no .env.local yet"
 * into an unreadable crash from inside supabase-js for anyone cloning the
 * repo — including on `npm test`, which needs no database whatsoever.
 *
 * A syntactically valid placeholder keeps the module importable so pure logic
 * stays testable with zero configuration. Any real query against it fails as a
 * request to a host that does not resolve, and the warning above has already
 * said why.
 */
export const db = createClient(
  url || "http://localhost:54321",
  key || "public-anon-key-placeholder",
  { auth: { persistSession: false }, ...(customFetch ? { global: { fetch: customFetch } } : {}) },
);

/** Single-user MVP: one deterministic local user until Supabase Auth lands. */
export const DEFAULT_USER_ID = "usr_local";

let userEnsured = false;
export async function ensureDefaultUser(email = "owner@sage.local") {
  if (userEnsured) return;
  const { error } = await db
    .from("User")
    .upsert({ id: DEFAULT_USER_ID, email, name: "Owner" }, { onConflict: "id" });
  if (error) {
    console.error("[db] ensureDefaultUser failed:", error.message);
    return;
  }
  userEnsured = true;
}
