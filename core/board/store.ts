/**
 * Boards, stored as Event rows.
 *
 * One row per board, holding the whole document — not one row per node. A
 * whiteboard mutates on every drag, so a row per object would turn a single
 * gesture into forty writes, and reading a board would be a join against
 * hundreds of rows to rebuild something that is conceptually one file.
 *
 * The same reasoning as core/places and core/feeds otherwise: the universal
 * store means no migration, and the generic trash and backup paths cover
 * boards for free the day they exist.
 */

import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { type BoardDoc, type BoardSummary, summarise, tooLarge } from "./types";

const TYPE = "board.doc";

export async function listBoards(): Promise<BoardSummary[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(200);
  return (data ?? [])
    .map((r) => summarise(r.payload as BoardDoc))
    // Most recently worked on first — a board index sorted by creation date
    // buries the one you were in the middle of.
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBoard(id: string): Promise<BoardDoc | null> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>id", id)
    .limit(1);
  return (data?.[0]?.payload as BoardDoc) ?? null;
}

export async function createBoard(doc: BoardDoc): Promise<BoardDoc | null> {
  const { error } = await db.from("Event").insert({
    // The column has no default, so the row id is supplied explicitly. Reusing
    // the board's own id keeps the row and the document addressable by the
    // same value.
    id: doc.id,
    userId: DEFAULT_USER_ID,
    type: TYPE,
    payload: doc,
  });
  return error ? null : doc;
}

export type SaveResult =
  | { ok: true; doc: BoardDoc }
  /** Someone else moved first. The caller gets the winning document back so it
   *  can show what is actually there rather than a bare failure. */
  | { ok: false; reason: "conflict"; current: BoardDoc }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "too-large"; bytes: number }
  | { ok: false; reason: "write-failed" };

/**
 * Save, refusing to overwrite a newer version.
 *
 * He has SAGE open on a phone and on a desktop. Last-write-wins here does not
 * mean a lost keystroke, it means a whole board silently reverting to whatever
 * the other device last had in memory — the kind of data loss you only notice
 * a week later, when the thing you drew is not there.
 */
export async function saveBoard(next: BoardDoc): Promise<SaveResult> {
  const current = await getBoard(next.id);
  if (!current) return { ok: false, reason: "missing" };
  if (next.version !== current.version) return { ok: false, reason: "conflict", current };

  const bytes = tooLarge(next);
  if (bytes !== null) return { ok: false, reason: "too-large", bytes };

  const saved: BoardDoc = { ...next, version: current.version + 1, updatedAt: new Date().toISOString() };
  const { error } = await db
    .from("Event")
    .update({ payload: saved })
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>id", next.id);

  return error ? { ok: false, reason: "write-failed" } : { ok: true, doc: saved };
}

export async function deleteBoard(id: string): Promise<boolean> {
  const { error } = await db
    .from("Event")
    .delete()
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>id", id);
  return !error;
}
