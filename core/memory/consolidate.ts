import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Memory consolidation — the half of the memory system that was never built.
 *
 * The schema has always carried supersededBy, expiresAt, accessCount and
 * lastAccessedAt, and recall has always filtered on supersededBy. But nothing
 * ever *set* any of them, so memories only accumulated: near-duplicates piled
 * up, contradicted facts stayed alongside the corrections that replaced them,
 * and a thing you said once in March ranked identically to one you rely on
 * daily. This retires memories rather than deleting them — superseding keeps
 * the trail, and recall already ignores anything superseded.
 *
 * Three passes, cheapest first:
 *   1. expiry     — anything past expiresAt
 *   2. duplicates — near-identical pairs, keep the better-evidenced one
 *   3. staleness  — old, unimportant, never once recalled
 *   4. conflicts  — one LLM pass over what survived, to catch contradictions
 */

export interface ConsolidationReport {
  scanned: number;
  expired: number;
  duplicates: number;
  stale: number;
  conflicts: number;
  retired: { id: string; content: string; reason: string; supersededBy?: string }[];
}

interface Row {
  id: string;
  type: string;
  content: string;
  importance: number;
  confidence: number;
  sourceType: string;
  accessCount: number;
  lastAccessedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** How long a memory may sit unused before it counts as stale. */
const STALE_AFTER_DAYS = 120;
/** Below this importance, an unused memory is not worth carrying. */
const STALE_IMPORTANCE = 0.45;
/** Word-overlap above this means two memories are saying the same thing. */
const DUPLICATE_OVERLAP = 0.82;

const conflictSchema = z.object({
  conflicts: z.array(
    z.object({
      keepId: z.string().describe("id of the memory that is currently true"),
      retireId: z.string().describe("id of the memory it contradicts and replaces"),
      reason: z.string().max(160),
    }),
  ),
});

const CONFLICT_PROMPT = `You are auditing a personal assistant's long-term memory for CONTRADICTIONS.

Report a pair only when both statements cannot be true at once about the same person — a changed job, a moved city, a reversed preference, a superseded goal. When they conflict, keep the more recent one and retire the older.

Do NOT report: memories that merely overlap or restate each other, two facts that can both hold, or anything about different subjects. Most memory sets contain no conflicts at all — an empty list is the normal answer.`;

/** Cheap lexical similarity — good enough to catch restatements without
 *  spending an embedding call per pair. */
function overlap(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3),
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}

/** Which of two duplicates to keep: user-stated beats inferred, then
 *  confidence, then importance, then whichever has actually been recalled. */
function stronger(a: Row, b: Row): [keep: Row, drop: Row] {
  const score = (m: Row) =>
    (m.sourceType === "user" ? 1 : 0) * 4 + m.confidence * 2 + m.importance + Math.min(m.accessCount, 5) * 0.1;
  return score(a) >= score(b) ? [a, b] : [b, a];
}

async function retire(id: string, supersededBy: string | null) {
  await db
    .from("Memory")
    .update({ supersededBy: supersededBy ?? id }) // self-reference = retired, not replaced
    .eq("id", id)
    .eq("userId", DEFAULT_USER_ID);
}

/**
 * Run a full consolidation pass. Safe to call repeatedly — everything it does
 * is idempotent, and already-superseded memories are never reconsidered.
 */
export async function consolidateMemories(): Promise<ConsolidationReport> {
  const { data } = await db
    .from("Memory")
    .select("id, type, content, importance, confidence, sourceType, accessCount, lastAccessedAt, expiresAt, createdAt")
    .eq("userId", DEFAULT_USER_ID)
    .is("supersededBy", null)
    .order("createdAt", { ascending: false })
    .limit(400);

  const rows = (data ?? []) as Row[];
  const report: ConsolidationReport = {
    scanned: rows.length,
    expired: 0,
    duplicates: 0,
    stale: 0,
    conflicts: 0,
    retired: [],
  };
  if (rows.length === 0) return report;

  const now = Date.now();
  const gone = new Set<string>();

  // ── 1. Expiry ────────────────────────────────────────────────────────────
  for (const m of rows) {
    if (m.expiresAt && new Date(m.expiresAt).getTime() <= now) {
      await retire(m.id, null);
      gone.add(m.id);
      report.expired += 1;
      report.retired.push({ id: m.id, content: m.content, reason: "expired" });
    }
  }

  // ── 2. Duplicates ────────────────────────────────────────────────────────
  // Only compare within a type: a goal and a routine that share words are not
  // the same memory.
  const byType = new Map<string, Row[]>();
  for (const m of rows) {
    if (gone.has(m.id)) continue;
    const list = byType.get(m.type) ?? [];
    list.push(m);
    byType.set(m.type, list);
  }

  for (const list of byType.values()) {
    for (let i = 0; i < list.length; i++) {
      if (gone.has(list[i].id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (gone.has(list[j].id)) continue;
        if (overlap(list[i].content, list[j].content) < DUPLICATE_OVERLAP) continue;
        const [keep, drop] = stronger(list[i], list[j]);
        await retire(drop.id, keep.id);
        gone.add(drop.id);
        report.duplicates += 1;
        report.retired.push({ id: drop.id, content: drop.content, reason: "duplicate", supersededBy: keep.id });
        // The pair's loser can be list[i] itself. Carrying on would compare a
        // memory that is already retired against the rest of the list, and
        // retire it a second time — which is how a sweep reported seven
        // duplicates while only five rows actually changed.
        if (drop.id === list[i].id) break;
      }
    }
  }

  // ── 3. Staleness ─────────────────────────────────────────────────────────
  // Never retire something the user stated themselves, however old — they said
  // it on purpose. This only sweeps up low-confidence inferences that have sat
  // unread for months.
  for (const m of rows) {
    if (gone.has(m.id) || m.sourceType === "user") continue;
    const ageDays = (now - new Date(m.createdAt).getTime()) / 86_400_000;
    const touched = m.accessCount > 0 || m.lastAccessedAt !== null;
    if (ageDays > STALE_AFTER_DAYS && !touched && m.importance < STALE_IMPORTANCE) {
      await retire(m.id, null);
      gone.add(m.id);
      report.stale += 1;
      report.retired.push({ id: m.id, content: m.content, reason: "stale" });
    }
  }

  // ── 4. Contradictions ────────────────────────────────────────────────────
  const survivors = rows.filter((m) => !gone.has(m.id));
  const model = getModel("fast");
  if (model && survivors.length > 1) {
    // Newest first and capped — a contradiction that matters almost always
    // involves something said recently.
    const sample = survivors.slice(0, 80);
    const listing = sample
      .map((m) => `${m.id} | ${m.type} | ${m.createdAt.slice(0, 10)} | ${m.content}`)
      .join("\n");

    try {
      const { object } = await generateObject({
        model,
        schema: conflictSchema,
        system: CONFLICT_PROMPT,
        prompt: `Memories (id | type | date | content):\n${listing}`,
      });

      const valid = new Set(sample.map((m) => m.id));
      for (const c of object.conflicts) {
        // The model can hallucinate ids or point a memory at itself; both would
        // corrupt the trail, so neither is trusted without checking.
        if (!valid.has(c.keepId) || !valid.has(c.retireId)) continue;
        if (c.keepId === c.retireId || gone.has(c.retireId)) continue;
        await retire(c.retireId, c.keepId);
        gone.add(c.retireId);
        report.conflicts += 1;
        report.retired.push({
          id: c.retireId,
          content: sample.find((m) => m.id === c.retireId)?.content ?? "",
          reason: `conflict: ${c.reason}`,
          supersededBy: c.keepId,
        });
      }
    } catch {
      // A failed audit must not lose the passes that already succeeded.
    }
  }

  // Always recorded, even on a clean pass — the once-a-day guard reads this
  // event, so skipping it when nothing was retired would make every tick
  // re-run the conflict audit and its model call.
  {
    await db.from("Event").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      type: "memory.consolidated",
      payload: {
        scanned: report.scanned,
        expired: report.expired,
        duplicates: report.duplicates,
        stale: report.stale,
        conflicts: report.conflicts,
        retired: report.retired.slice(0, 40),
      },
    });
  }

  return report;
}

/**
 * Consolidate at most once a day. The cron ticks far more often than that, and
 * the conflict audit is the one part of this that costs a model call.
 */
export async function maybeConsolidateMemories(): Promise<ConsolidationReport | null> {
  const { data: last } = await db
    .from("Event")
    .select("createdAt")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "memory.consolidated")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last?.createdAt && Date.now() - new Date(last.createdAt as string).getTime() < 20 * 3600_000) {
    return null;
  }
  return consolidateMemories();
}
