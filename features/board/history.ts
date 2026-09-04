import type { BoardDoc } from "@/core/board/types";

/**
 * Undo, as a stack of snapshots.
 *
 * Snapshots rather than inverse operations. Inverse ops are smaller, and they
 * are also where undo goes wrong: every new mutation needs its own inverse,
 * one of them is subtly asymmetric, and the bug surfaces as a board that
 * quietly loses a node three undos later. A board document is small enough
 * that copying it is free, and a snapshot cannot be asymmetric.
 *
 * Two behaviours that are the whole reason this is a module and not a `useRef`
 * of an array, and both are tested:
 *
 * - **Coalescing.** Dragging a node fires a mutation per pointer move. Without
 *   coalescing, one drag is forty undo entries and ⌘Z appears to do nothing.
 *   Edits of the same kind within COALESCE_MS collapse into one.
 * - **Redo is cleared by a new edit.** Undo twice, then draw: the redo branch
 *   is gone. Keeping it lets ⇧⌘Z jump into a history that no longer connects
 *   to what is on screen.
 */

export const LIMIT = 60;
export const COALESCE_MS = 500;

export interface Entry {
  doc: BoardDoc;
  /** What produced it — "move", "ink", "text". Only same-kind edits coalesce. */
  kind: string;
  at: number;
}

export interface History {
  past: Entry[];
  future: Entry[];
}

export const emptyHistory = (): History => ({ past: [], future: [] });

/**
 * Record the document as it was *before* an edit.
 *
 * Before, not after: undo restores the state you were in, and a stack of
 * "after" snapshots is always one step out of phase — the first ⌘Z appears to
 * do nothing because it restores what is already on screen.
 */
export function record(h: History, before: BoardDoc, kind: string, now = Date.now()): History {
  const last = h.past[h.past.length - 1];
  if (last && last.kind === kind && now - last.at < COALESCE_MS) {
    // Same continuous gesture: keep the older snapshot (it is the one the user
    // means to get back to) and only extend the window.
    return { past: [...h.past.slice(0, -1), { ...last, at: now }], future: [] };
  }
  const past = [...h.past, { doc: before, kind, at: now }];
  return { past: past.length > LIMIT ? past.slice(past.length - LIMIT) : past, future: [] };
}

export function undo(h: History, current: BoardDoc): { history: History; doc: BoardDoc } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, { doc: current, kind: entry.kind, at: Date.now() }] },
    doc: entry.doc,
  };
}

export function redo(h: History, current: BoardDoc): { history: History; doc: BoardDoc } | null {
  const entry = h.future[h.future.length - 1];
  if (!entry) return null;
  return {
    history: { past: [...h.past, { doc: current, kind: entry.kind, at: Date.now() }], future: h.future.slice(0, -1) },
    doc: entry.doc,
  };
}
