import { createClient } from "@supabase/supabase-js";

/**
 * Server-side data access over HTTPS (PostgREST). Prisma remains the
 * schema/migration source of truth; runtime queries go through Supabase
 * so the app works in HTTPS-only environments too.
 */
export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

/** Single-user MVP: one deterministic local user until Supabase Auth lands. */
export const DEFAULT_USER_ID = "usr_local";

let userEnsured = false;
export async function ensureDefaultUser(email = "owner@sage.local") {
  if (userEnsured) return;
  await db
    .from("User")
    .upsert({ id: DEFAULT_USER_ID, email, name: "Owner" }, { onConflict: "id" });
  userEnsured = true;
}
