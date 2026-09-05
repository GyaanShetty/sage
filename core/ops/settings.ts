import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Settings that are configuration, not credentials.
 *
 * The key store encrypts everything it holds and refuses to write without
 * KEY_SECRET — correct for a client secret, and wrong for the values that sit
 * beside one. The Outlook tenant is the case that proved it: a directory GUID
 * is public, it appears in the sign-in URL, Microsoft prints it in its own
 * error messages. Storing it sealed meant SAGE could work out the right tenant
 * and then fail to save it, which is exactly what happened — "Could not write
 * the key" on a value that never needed protecting.
 *
 * Plain Event rows, like places and feeds. Nothing here may hold a secret.
 */

const TYPE = "setting";

export type Setting = "outlook_tenant";

export async function getSetting(name: Setting): Promise<string | null> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>name", name)
    .order("createdAt", { ascending: false })
    .limit(1);
  const v = (data?.[0]?.payload as { value?: string } | undefined)?.value;
  return v?.trim() || null;
}

export async function setSetting(name: Setting, value: string): Promise<boolean> {
  const clean = value.trim();
  if (!clean) return false;

  // Replace rather than append: reading takes the newest row, so leaving the
  // old ones behind would work and would also leave a trail of stale values
  // that the next person to read this table has to reason about.
  await db
    .from("Event")
    .delete()
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>name", name);

  const { error } = await db.from("Event").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    type: TYPE,
    payload: { name, value: clean, at: new Date().toISOString() },
  });
  return !error;
}
