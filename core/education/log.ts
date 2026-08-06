import { tzDay, lastDays } from "@/lib/config";
import { trashRow } from "@/core/ops/trash";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * A study log, per skill.
 *
 * A skill already had a level and a single notes field. A level says where you
 * are; it says nothing about how you got there, and one notes field turns into
 * an unreadable wall the moment you use it twice. What is actually useful
 * later is the trail: what you covered on a given day, the link you were
 * reading, the thing that finally made it click.
 *
 * So entries are timestamped and append-only. Editing history to look tidier
 * would defeat the purpose of keeping it.
 */

const TYPE = "skill.log";

export const ENTRY_KINDS = ["session", "note", "resource", "question", "insight"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const KIND_META: Record<EntryKind, { label: string; hint: string }> = {
  session: { label: "Session", hint: "Time spent, and what you covered" },
  note: { label: "Note", hint: "Something worth writing down" },
  resource: { label: "Resource", hint: "A link, book or course to come back to" },
  question: { label: "Question", hint: "Something you did not understand — worth revisiting" },
  insight: { label: "Insight", hint: "The thing that made it click" },
};

export interface LogEntry {
  id: string;
  skillId: string;
  kind: EntryKind;
  text: string;
  /** Optional link — a paper, a video, a problem set. */
  url?: string;
  /** Minutes, for sessions. */
  minutes?: number;
  /** Free tags: "trees", "chapter 4", "revisit". */
  tags: string[];
  at: string;
  /** Questions can be answered later without losing that you asked them. */
  resolvedAt?: string;
}

export async function addEntry(input: {
  skillId: string;
  kind: EntryKind;
  text: string;
  url?: string;
  minutes?: number;
  tags?: string[];
}): Promise<LogEntry | null> {
  if (!input.skillId || !input.text.trim()) return null;

  const entry: LogEntry = {
    id: crypto.randomUUID(),
    skillId: input.skillId,
    kind: ENTRY_KINDS.includes(input.kind) ? input.kind : "note",
    text: input.text.trim().slice(0, 4000),
    ...(input.url?.trim() ? { url: input.url.trim().slice(0, 500) } : {}),
    ...(Number.isFinite(input.minutes) && (input.minutes ?? 0) > 0
      ? { minutes: Math.min(1440, Math.round(input.minutes as number)) }
      : {}),
    tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
    at: new Date().toISOString(),
  };

  await db.from("Event").insert({
    id: entry.id, userId: DEFAULT_USER_ID, type: TYPE, payload: entry,
  });
  return entry;
}

export async function listEntries(skillId?: string, limit = 200): Promise<LogEntry[]> {
  let q = db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE);
  if (skillId) q = q.eq("payload->>skillId", skillId);

  const { data } = await q.order("createdAt", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => r.payload as LogEntry).filter((e) => e?.id);
}

export async function deleteEntry(id: string): Promise<boolean> {
  const error = await trashRow("Event", id).then(() => null, (e: Error) => e);
  return !error;
}

/** Mark an open question answered — it stays in the log, with a date on it. */
export async function resolveEntry(id: string): Promise<boolean> {
  const { data } = await db
    .from("Event").select("payload").eq("id", id).eq("userId", DEFAULT_USER_ID).maybeSingle();
  if (!data) return false;
  const prev = data.payload as LogEntry;
  await db.from("Event")
    .update({ payload: { ...prev, resolvedAt: new Date().toISOString() } })
    .eq("id", id);
  return true;
}

export interface StudyStats {
  entries: number;
  minutes: number;
  sessions: number;
  /** Questions still unanswered — the honest measure of what you do not know. */
  openQuestions: LogEntry[];
  resources: LogEntry[];
  /** Study minutes per day for the last fortnight, oldest first. */
  recent: { day: string; minutes: number }[];
  lastStudiedAt: string | null;
}

/**
 * What the log adds up to.
 *
 * Open questions are surfaced deliberately: they are the only honest record of
 * what you do not understand yet, and they are the first thing a level number
 * hides.
 */
export function studyStats(entries: LogEntry[]): StudyStats {
  const sessions = entries.filter((e) => e.kind === "session");
  const minutes = sessions.reduce((a, e) => a + (e.minutes ?? 0), 0);

  const byDay = new Map<string, number>();
  const since = Date.now() - 14 * 86_400_000;
  for (const e of sessions) {
    const t = new Date(e.at).getTime();
    if (Number.isNaN(t) || t < since) continue;
    const day = tzDay(e.at);
    byDay.set(day, (byDay.get(day) ?? 0) + (e.minutes ?? 0));
  }

  // Both sides of this join must be his calendar days, not UTC ones — see
  // tzDay. Studying at 1am used to be filed under the previous day, and the
  // axis rolled over at 05:30 rather than midnight.
  const recent = lastDays(14).map((day) => ({ day, minutes: byDay.get(day) ?? 0 }));

  return {
    entries: entries.length,
    minutes,
    sessions: sessions.length,
    openQuestions: entries.filter((e) => e.kind === "question" && !e.resolvedAt),
    resources: entries.filter((e) => e.kind === "resource" && e.url),
    recent,
    lastStudiedAt: entries[0]?.at ?? null,
  };
}
