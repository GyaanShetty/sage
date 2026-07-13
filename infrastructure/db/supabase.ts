import { createClient } from "@supabase/supabase-js";
import { fetch as undiciFetch, EnvHttpProxyAgent } from "undici";

// In proxied dev environments Next's bundled fetch bypasses HTTPS_PROXY;
// hand supabase-js an explicitly proxy-aware fetch. No-op in production.
const proxyAgent = process.env.HTTPS_PROXY || process.env.https_proxy ? new EnvHttpProxyAgent() : null;
const customFetch = proxyAgent
  ? ((((url: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
      undiciFetch(url, { ...init, dispatcher: proxyAgent })) as unknown) as typeof globalThis.fetch)
  : undefined;

/**
 * Server-side data access over HTTPS (PostgREST). Prisma remains the
 * schema/migration source of truth; runtime queries go through Supabase
 * so the app works in HTTPS-only environments too.
 */
export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
