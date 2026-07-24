import webpush from "web-push";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Web Push (VAPID) fan-out. Subscriptions are stored as Events of type
 * "push.subscription" (payload = the browser PushSubscription). Keys live in
 * env only — VAPID_PUBLIC_KEY is safe to expose to the client, VAPID_PRIVATE_KEY
 * is server-only and never committed. If keys are absent this is a no-op, so the
 * rest of SAGE keeps working without push configured.
 */

let configured = false;
function ensure(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:gyaanshetty@gmail.com", pub, priv);
    configured = true;
  }
  return true;
}

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

interface StoredSub {
  id: string;
  payload: webpush.PushSubscription;
}

export async function saveSubscription(sub: webpush.PushSubscription): Promise<void> {
  // Dedup by endpoint so re-subscribing the same device doesn't pile up.
  const { data: existing } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "push.subscription")
    .limit(200);
  const dupe = (existing ?? []).find(
    (e) => (e.payload as webpush.PushSubscription)?.endpoint === sub.endpoint,
  );
  if (dupe) return;
  await db.from("Event").insert({
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    type: "push.subscription",
    payload: sub,
  });
}

export interface PushMessage {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/** Send a notification to every registered device. Prunes dead subscriptions
 *  (410/404) as it goes. Returns the number delivered. */
export async function sendPush(msg: PushMessage): Promise<number> {
  if (!ensure()) return 0;
  const { data } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "push.subscription")
    .limit(200);
  const subs = (data ?? []) as StoredSub[];
  if (!subs.length) return 0;

  const body = JSON.stringify({
    title: msg.title,
    body: msg.body,
    tag: msg.tag ?? "sage",
    url: msg.url ?? "/dashboard",
  });

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.payload, body);
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
      }
    }),
  );
  if (dead.length) await db.from("Event").delete().in("id", dead);
  return sent;
}
