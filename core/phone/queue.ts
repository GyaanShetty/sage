import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Actions for the phone to carry out.
 *
 * A web app cannot set an iOS alarm or write to Reminders — there is no API
 * for it and no amount of engineering invents one. What the phone *can* do is
 * ask. So SAGE decides, writes the intent here, and an iOS Shortcut (or Tasker
 * on Android) drains the queue and performs each action natively.
 *
 * Two properties matter and both are deliberate:
 *
 *  - Draining is a claim, not a read. An action is marked taken the moment it
 *    is handed out, so two devices polling at once cannot both set the same
 *    alarm.
 *  - Actions expire. A reminder that failed to reach the phone for six hours
 *    is worse than useless — it fires at the wrong moment, out of context.
 */

const TYPE = "phone.action";

export const PHONE_ACTIONS = ["reminder", "alarm", "calendar", "notify", "focus", "play"] as const;
export type PhoneActionKind = (typeof PHONE_ACTIONS)[number];

export interface PhoneAction {
  id: string;
  kind: PhoneActionKind;
  /** What to say or title the item. */
  text: string;
  /** ISO time the action refers to — when to remind, when to ring. */
  at?: string;
  /** Free extras a Shortcut may use: list name, focus mode, playlist. */
  detail?: string;
  createdAt: string;
  takenAt?: string;
}

/** Actions older than this are dropped undelivered rather than fired late. */
const EXPIRY_MS = 6 * 60 * 60 * 1000;

export async function enqueuePhoneAction(
  action: Omit<PhoneAction, "id" | "createdAt" | "takenAt">,
): Promise<PhoneAction> {
  const queued: PhoneAction = {
    ...action,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await db.from("Event").insert({
    id: queued.id, userId: DEFAULT_USER_ID, type: TYPE, payload: queued,
  });
  return queued;
}

/**
 * Hand out everything pending and mark it taken in the same breath.
 * `peek` reads without claiming, for the UI.
 */
export async function drainPhoneActions(peek = false): Promise<PhoneAction[]> {
  const { data } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: true })
    .limit(50);

  const now = Date.now();
  const out: PhoneAction[] = [];
  const expired: string[] = [];

  for (const row of data ?? []) {
    const a = row.payload as PhoneAction;
    if (!a || a.takenAt) continue;
    if (now - new Date(a.createdAt).getTime() > EXPIRY_MS) { expired.push(row.id as string); continue; }
    out.push(a);
  }

  if (expired.length > 0) {
    await db.from("Event").delete().in("id", expired);
  }
  if (!peek && out.length > 0) {
    const takenAt = new Date().toISOString();
    await Promise.all(
      out.map((a) =>
        db.from("Event").update({ payload: { ...a, takenAt } }).eq("id", a.id),
      ),
    );
  }
  return out;
}

/** Recently issued actions, taken or not — so the UI can show what SAGE asked
 *  the phone to do and whether it ever collected them. */
export async function recentPhoneActions(limit = 20): Promise<PhoneAction[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => r.payload as PhoneAction).filter(Boolean);
}
