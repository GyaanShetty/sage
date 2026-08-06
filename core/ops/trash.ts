import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * Deleting things you can get back.
 *
 * Every delete in SAGE was immediate and final: a workout, a memory, a
 * holding, a note, a decision. Most are one tap, several sit next to a
 * frequently-used control, and none of them asked twice. On a phone that is a
 * matter of time rather than luck.
 *
 * So deletes now copy the whole row here first. Nothing about the calling code
 * changes — the row still disappears from its table, every list still filters
 * it out for free — but for thirty days it can be put back exactly as it was.
 *
 * Deliberately a snapshot rather than a `deletedAt` column. A soft-delete flag
 * means every query everywhere has to remember to exclude it, and the one that
 * forgets shows deleted data as though it were live. Moving the row out keeps
 * the failure mode in the safe direction: the worst case is that something is
 * gone from a list, not that something deleted is quietly still counted.
 */

const TYPE = "ops.trash";
export const TRASH_DAYS = 30;

export interface TrashItem {
  id: string;
  table: string;
  rowId: string;
  /** Best-effort human label, so the trash is readable without decoding rows. */
  label: string;
  kind: string;
  deletedAt: string;
  row: Record<string, unknown>;
}

/** Pull something worth showing out of an arbitrary row. */
function describe(table: string, row: Record<string, unknown>): { label: string; kind: string } {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const text =
    (typeof row.title === "string" && row.title) ||
    (typeof row.content === "string" && row.content) ||
    (typeof row.text === "string" && row.text) ||
    (typeof payload.title === "string" && payload.title) ||
    (typeof payload.symbol === "string" && payload.symbol) ||
    (typeof payload.merchant === "string" && payload.merchant) ||
    (typeof payload.type === "string" && payload.type) ||
    (typeof payload.name === "string" && payload.name) ||
    (typeof payload.content === "string" && payload.content) ||
    "";

  const kind = table === "Event" ? String(row.type ?? "event") : table;
  return { label: String(text).slice(0, 120) || kind, kind };
}

/**
 * Delete a row, keeping a copy.
 *
 * Returns false when there was nothing to delete, so callers can tell "already
 * gone" from "deleted" without a second query.
 */
export async function trashRow(table: string, id: string): Promise<boolean> {
  const { data: row } = await db
    .from(table).select("*")
    .eq("id", id).eq("userId", DEFAULT_USER_ID)
    .maybeSingle();
  if (!row) return false;

  const { label, kind } = describe(table, row as Record<string, unknown>);

  // Snapshot first. If this insert fails the delete does not happen, which is
  // the right way round: a row that survives a failed delete is an annoyance,
  // a row deleted without a copy is the thing this exists to prevent.
  const { error } = await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE,
    payload: { table, rowId: id, label, kind, deletedAt: new Date().toISOString(), row },
  });
  if (error) throw new Error(`Couldn't take a copy before deleting: ${error.message}`);

  await db.from(table).delete().eq("id", id).eq("userId", DEFAULT_USER_ID);
  return true;
}

export async function listTrash(limit = 50): Promise<TrashItem[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .order("createdAt", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<TrashItem, "id">) }));
}

/** Put one back, exactly as it was. */
export async function restoreTrash(trashId: string): Promise<{ ok: boolean; error?: string; label?: string }> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("id", trashId).eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .maybeSingle();
  if (!data) return { ok: false, error: "That item is no longer in the trash." };

  const item = data.payload as Omit<TrashItem, "id">;

  // Upsert rather than insert: if something with that id exists again — a
  // restore run twice, or a row recreated by hand — the restore should be a
  // no-op rather than an error he has to interpret.
  const { error } = await db.from(item.table).upsert(item.row, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };

  await db.from("Event").delete().eq("id", trashId);
  return { ok: true, label: item.label };
}

/** Empty the trash, or just the part that has aged out. */
export async function purgeTrash(olderThanDays = TRASH_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", TYPE)
    .limit(500);

  const stale = (data ?? []).filter((r) => {
    const at = (r.payload as { deletedAt?: string })?.deletedAt;
    return !at || at < cutoff;
  });
  if (stale.length === 0) return 0;

  await db.from("Event").delete().in("id", stale.map((r) => r.id));
  return stale.length;
}
