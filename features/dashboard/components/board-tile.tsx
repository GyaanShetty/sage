"use client";

/**
 * The whiteboard, on the wall.
 *
 * It was an index — "Board 1", "Board 2" — in a quarter tile, which told him
 * his boards existed and made him leave the dashboard to use one. He calls
 * the board his main workspace and asked for it to be here with room, so
 * this is the real canvas: the same component the /board page renders, with
 * every tool, saving on the same debounce.
 *
 * Loaded on demand rather than with the page. BoardCanvas is the heaviest
 * thing in the tree and a board document can be large, so pulling both into
 * the dashboard's first paint would cost every visit for a panel he might
 * scroll past. The tile renders its header immediately and fetches when it
 * first comes near the viewport.
 *
 * `embedded` is what makes it safe to put here: it scopes the single-key
 * tool shortcuts to when the board holds focus, and drops the
 * unsaved-changes prompt that would otherwise block leaving the dashboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Pane } from "@/components/pane";
import { BoardCanvas } from "@/features/board/board-canvas";
import type { BoardDoc } from "@/core/board/types";
import { asArray } from "@/lib/as-array";
import { sound } from "@/lib/sound";
import { Maximize2 } from "lucide-react";

interface Summary { id: string; title: string; nodes: number; strokes: number; updatedAt: string }

export function BoardTile({ n }: { n?: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const [boards, setBoards] = useState<Summary[]>([]);
  const [docId, setDocId] = useState<string | null>(null);
  const [doc, setDoc] = useState<BoardDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /* Mount the canvas when the tile is within a screen of the viewport. A
     whiteboard eight rows down the wall does not need to exist while he is
     reading his mail. */
  useEffect(() => {
    const el = hostRef.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let gone = false;
    (async () => {
      try {
        const list = asArray<Summary>(
          (await fetch("/api/board").then((r) => r.json()))?.data,
        ).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
        if (gone) return;
        setBoards(list);
        setDocId((cur) => cur ?? list[0]?.id ?? null);
        if (!list.length) setErr("none");
      } catch {
        if (!gone) setErr("list");
      }
    })();
    return () => { gone = true; };
  }, [near]);

  useEffect(() => {
    if (!docId) return;
    let gone = false;
    setDoc(null);
    fetch(`/api/board/${encodeURIComponent(docId)}`)
      .then((r) => r.json())
      .then((j) => { if (!gone) { if (j?.ok) setDoc(j.data as BoardDoc); else setErr("read"); } })
      .catch(() => { if (!gone) setErr("read"); });
    return () => { gone = true; };
  }, [docId]);

  const create = useCallback(async () => {
    const j = await fetch("/api/board", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }),
    }).then((r) => r.json()).catch(() => null);
    if (j?.ok) {
      sound.blip();
      setErr(null);
      setBoards((b) => [{ id: j.data.id, title: j.data.title, nodes: 0, strokes: 0, updatedAt: j.data.updatedAt }, ...b]);
      setDocId(j.data.id);
    }
  }, []);

  const current = boards.find((b) => b.id === docId);

  return (
    <Pane
      n={n}
      title="Whiteboard"
      status={
        <span className="bt-switch">
          {boards.slice(0, 4).map((b) => (
            <button
              key={b.id}
              className={`bt-tab${b.id === docId ? " on" : ""}`}
              onClick={() => { setDocId(b.id); sound.detent(); }}
            >
              {b.title || "Untitled"}
            </button>
          ))}
          <button className="bt-tab bt-new" onClick={() => void create()}>+ NEW</button>
          {current && (
            <Link className="bt-open" href={`/board/${current.id}`} title="Open full screen">
              <Maximize2 className="size-3" />
            </Link>
          )}
        </span>
      }
      live={!!doc}
      noZoom
    >
      <div className="bt-host" ref={hostRef}>
        {!near && <div className="tile-wait">THE BOARD LOADS WHEN YOU REACH IT</div>}
        {near && err === "none" && (
          <div className="empty-state">
            <div className="es-t">No boards yet</div>
            <div className="es-d">
              <button className="live bt-link" onClick={() => void create()}>Start one →</button>
            </div>
          </div>
        )}
        {near && err && err !== "none" && (
          <div className="empty-state">
            <div className="es-t">The board would not load</div>
            <div className="es-d"><Link className="live" href="/board">Open the workspace →</Link></div>
          </div>
        )}
        {near && !err && !doc && <div className="tile-wait">OPENING THE BOARD…</div>}
        {/* Keyed on the id so switching boards remounts rather than trying to
            reconcile one document's nodes into another's. */}
        {doc && <BoardCanvas key={doc.id} initial={doc} embedded />}
      </div>
    </Pane>
  );
}
