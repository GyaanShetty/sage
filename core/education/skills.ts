import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Skill tracking.
 *
 * Deliberately unopinionated about what a "skill" is. The obvious design is a
 * fixed syllabus — DSA, DBMS, OS, Networks — but a fixed list is wrong within a
 * month: topics split, new ones appear, and the ones you have finished should
 * get out of the way. So categories are free text, everything is editable, and
 * nothing is seeded that cannot be renamed or deleted.
 *
 * Level is 0–5 rather than a percentage. A percentage invites false precision
 * ("I'm 63% through dynamic programming"), whereas five rungs map onto how
 * people actually talk about competence.
 */

const TYPE = "skill.node";
const LOG = "skill.progress";

export const LEVELS = [
  "untouched",   // 0 — on the list, not started
  "aware",       // 1 — read about it, could not use it
  "practising",  // 2 — can do it with help or references
  "competent",   // 3 — can do it unaided
  "fluent",      // 4 — fast, and can spot the traps
  "teaching",    // 5 — can explain it to someone else cold
] as const;

export interface Skill {
  id: string;
  name: string;
  /** Free text: "DSA", "Systems", "Finance" — whatever grouping is useful now. */
  category: string;
  level: number;          // 0..5
  target: number;         // 0..5, where you want to be
  notes?: string;
  /** Reference links: a playlist, a book, a problem set. */
  resources?: { label: string; url: string }[];
  lastPractisedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressEntry {
  id: string;
  skillId: string;
  at: string;
  from: number;
  to: number;
  note?: string;
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;

export async function listSkills(): Promise<Skill[]> {
  const { data } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: true })
    .limit(300);
  return (data ?? [])
    .map((r) => ({ ...(r.payload as Omit<Skill, "id">), id: r.id as string }))
    .filter((s) => !!s.name);
}

export async function upsertSkill(input: Partial<Skill> & { id?: string }): Promise<Skill | null> {
  const now = new Date().toISOString();

  if (input.id) {
    const { data } = await db.from("Event").select("payload").eq("id", input.id).maybeSingle();
    if (!data) return null;
    const prev = data.payload as Skill;
    const next: Skill = {
      ...prev,
      ...input,
      level: input.level !== undefined ? clamp(input.level, 0, 5, prev.level) : prev.level,
      target: input.target !== undefined ? clamp(input.target, 0, 5, prev.target) : prev.target,
      id: input.id,
      updatedAt: now,
    };
    // Moving the level is the thing worth a history entry; renaming is not.
    if (input.level !== undefined && input.level !== prev.level) {
      next.lastPractisedAt = now;
      await db.from("Event").insert({
        id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: LOG,
        payload: { skillId: input.id, at: now, from: prev.level, to: next.level, note: input.notes },
      });
    }
    await db.from("Event").update({ payload: next }).eq("id", input.id).eq("userId", DEFAULT_USER_ID);
    return next;
  }

  if (!input.name?.trim()) return null;
  const id = crypto.randomUUID();
  const skill: Skill = {
    id,
    name: input.name.trim().slice(0, 120),
    category: (input.category?.trim() || "General").slice(0, 60),
    level: clamp(input.level, 0, 5, 0),
    target: clamp(input.target, 0, 5, 3),
    notes: input.notes?.slice(0, 2000),
    resources: (input.resources ?? []).slice(0, 12),
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: TYPE, payload: skill });
  return error ? null : skill;
}

export async function deleteSkill(id: string): Promise<boolean> {
  const { error } = await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID).eq("type", TYPE);
  return !error;
}

export async function skillHistory(skillId: string, limit = 30): Promise<ProgressEntry[]> {
  const { data } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", LOG)
    .eq("payload->>skillId", skillId)
    .order("createdAt", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({ ...(r.payload as Omit<ProgressEntry, "id">), id: r.id as string }));
}

export interface SkillSummary {
  total: number;
  byCategory: Record<string, { count: number; level: number; target: number }>;
  /** Skills furthest below their target — what to work on next. */
  gaps: { id: string; name: string; category: string; level: number; target: number; gap: number }[];
  /** Untouched for a while, and not yet at target. */
  rusty: { id: string; name: string; days: number }[];
  averageLevel: number;
}

const DAY = 86_400_000;

export function summarise(skills: Skill[]): SkillSummary {
  const byCategory: SkillSummary["byCategory"] = {};
  for (const s of skills) {
    const c = (byCategory[s.category] ??= { count: 0, level: 0, target: 0 });
    c.count += 1; c.level += s.level; c.target += s.target;
  }
  for (const c of Object.values(byCategory)) {
    c.level = Number((c.level / c.count).toFixed(1));
    c.target = Number((c.target / c.count).toFixed(1));
  }

  const gaps = skills
    .map((s) => ({ id: s.id, name: s.name, category: s.category, level: s.level, target: s.target, gap: s.target - s.level }))
    .filter((g) => g.gap > 0)
    .sort((a, b) => b.gap - a.gap || a.level - b.level)
    .slice(0, 8);

  const now = Date.now();
  const rusty = skills
    .filter((s) => s.level > 0 && s.level < s.target && s.lastPractisedAt)
    .map((s) => ({ id: s.id, name: s.name, days: Math.floor((now - new Date(s.lastPractisedAt!).getTime()) / DAY) }))
    .filter((r) => r.days >= 21)
    .sort((a, b) => b.days - a.days)
    .slice(0, 6);

  return {
    total: skills.length,
    byCategory,
    gaps,
    rusty,
    averageLevel: skills.length ? Number((skills.reduce((n, s) => n + s.level, 0) / skills.length).toFixed(2)) : 0,
  };
}
