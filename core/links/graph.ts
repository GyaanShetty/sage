import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * The link graph — one relationship store for the whole OS.
 *
 * Every page held its own island of data: a task knew nothing about the
 * application it was for, a note knew nothing about the memory it came from,
 * and a file belonged to exactly one career card and nowhere else. The
 * connections existed in your head and nowhere in the system.
 *
 * Rather than add a foreign key per pair — tasks-to-applications,
 * notes-to-memories, and so on, forever — this stores one kind of row: an
 * undirected edge between two addressable things. Anything with a kind and an
 * id can be linked to anything else, including plain URLs and uploaded files,
 * and nothing needs a migration to join in.
 */

export const LINK_KINDS = [
  "task", "note", "memory", "application", "holding",
  "automation", "report", "url", "file", "thread",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface LinkEnd {
  kind: LinkKind;
  /** For url/file this is the address or storage path; otherwise a row id. */
  id: string;
  /** Denormalised on purpose — a link must still read sensibly after the thing
   *  it points at has been deleted, and one query should not fan out into six. */
  label: string;
}

export interface Link {
  id: string;
  createdAt: string;
  from: LinkEnd;
  to: LinkEnd;
  note?: string;
}

const TYPE = "link.edge";

/** Stable identity for an edge, order-independent: linking A→B twice, or B→A
 *  after A→B, must not create a second edge. */
function edgeKey(a: LinkEnd, b: LinkEnd): string {
  const one = `${a.kind}:${a.id}`;
  const two = `${b.kind}:${b.id}`;
  return one < two ? `${one}|${two}` : `${two}|${one}`;
}

export async function addLink(from: LinkEnd, to: LinkEnd, note?: string): Promise<Link | null> {
  // Self-links are always a mistake and they render as an item related to itself.
  if (from.kind === to.kind && from.id === to.id) return null;

  const key = edgeKey(from, to);
  const { data: existing } = await db
    .from("Event")
    .select("id, createdAt, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .contains("payload", { key })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const p = existing.payload as { from: LinkEnd; to: LinkEnd; note?: string };
    return { id: existing.id as string, createdAt: existing.createdAt as string, ...p };
  }

  const id = crypto.randomUUID();
  const payload = { key, from, to, ...(note ? { note } : {}) };
  const { error } = await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: TYPE, payload });
  if (error) return null;
  return { id, createdAt: new Date().toISOString(), from, to, note };
}

export async function removeLink(id: string): Promise<boolean> {
  const { error } = await db.from("Event").delete().eq("id", id).eq("userId", DEFAULT_USER_ID).eq("type", TYPE);
  return !error;
}

/**
 * Everything connected to one thing, in either direction, presented from its
 * point of view: `other` is always the far end, so callers never have to work
 * out which side they were on.
 */
export async function linksFor(kind: LinkKind, id: string): Promise<(Link & { other: LinkEnd })[]> {
  // Filter in Postgres on the JSON path rather than pulling every edge back
  // and sifting in JS. The scan version was fine at ten links and quietly
  // linear in the size of the whole graph.
  const [fromSide, toSide] = await Promise.all([
    db.from("Event").select("id, createdAt, payload")
      .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
      .eq("payload->from->>kind", kind).eq("payload->from->>id", id).limit(200),
    db.from("Event").select("id, createdAt, payload")
      .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
      .eq("payload->to->>kind", kind).eq("payload->to->>id", id).limit(200),
  ]);
  const data = [...(fromSide.data ?? []), ...(toSide.data ?? [])];

  const out: (Link & { other: LinkEnd })[] = [];
  for (const row of data) {
    const p = row.payload as { from?: LinkEnd; to?: LinkEnd; note?: string };
    if (!p.from || !p.to) continue;
    const isFrom = p.from.kind === kind && p.from.id === id;
    const isTo = p.to.kind === kind && p.to.id === id;
    if (!isFrom && !isTo) continue;
    out.push({
      id: row.id as string,
      createdAt: row.createdAt as string,
      from: p.from,
      to: p.to,
      note: p.note,
      other: isFrom ? p.to : p.from,
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Link counts for many things at once, so a list can show them without one
 *  query per row. */
export async function linkCounts(kind: LinkKind, ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .limit(1000);

  const want = new Set(ids);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const p = row.payload as { from?: LinkEnd; to?: LinkEnd };
    for (const end of [p.from, p.to]) {
      if (end && end.kind === kind && want.has(end.id)) counts[end.id] = (counts[end.id] ?? 0) + 1;
    }
  }
  return counts;
}

/** Where a link should navigate to. Kinds without a page of their own resolve
 *  to the closest list rather than a dead route. */
export function hrefFor(end: LinkEnd): string {
  switch (end.kind) {
    case "url": return end.id;
    case "task": return "/workspace";
    case "note": return "/workspace";
    case "memory": return "/memory";
    case "application": return "/career";
    case "holding": return "/portfolio";
    case "automation": return "/automations";
    case "report": return "/report";
    case "thread": return "/chat";
    case "file": return `/api/files?path=${encodeURIComponent(end.id)}`;
    default: return "/dashboard";
  }
}
