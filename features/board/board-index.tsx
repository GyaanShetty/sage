"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BoardSummary } from "@/core/board/types";
import { TZ } from "@/lib/config";
import "./board.css";

/** The board index. New board first, then most recently worked on. */
export function BoardIndex({ initial }: { initial: BoardSummary[] }) {
  const [boards, setBoards] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();

  const create = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: `Board ${boards.length + 1}` }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setNote(j?.error ?? "Could not create the board."); return; }
      // Straight into it. A new empty board added to a list is a second click
      // to reach the thing you just asked for.
      router.push(`/board/${j.data.id}`);
    } catch {
      setNote("Couldn't reach SAGE.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? The drawing cannot be recovered.`)) return;
    const before = boards;
    setBoards((b) => b.filter((x) => x.id !== id));
    const res = await fetch(`/api/board?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    // Put it back if the server disagreed, rather than leaving the list
    // showing a deletion that did not happen.
    if (!res.ok) { setBoards(before); setNote("Delete failed."); }
  };

  return (
    <div style={{ padding: 12, display: "grid", gap: 10 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 15, letterSpacing: "0.14em", textTransform: "uppercase" }}>Boards</h1>
        <span style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--subtle)", textTransform: "uppercase" }}>
          {boards.length} saved · draw, note, attach, connect
        </span>
      </header>

      {note && <div style={{ color: "var(--signal)", fontSize: 12 }}>{note}</div>}

      <div className="bd-ix">
        <button className="new" onClick={() => void create()} disabled={busy}>
          <span className="ti">{busy ? "Creating…" : "+ New board"}</span>
          <span className="mt">Infinite canvas</span>
        </button>

        {boards.map((b) => (
          <Link key={b.id} href={`/board/${b.id}`}>
            <span className="ti">{b.title}</span>
            <span className="mt">{b.nodes} nodes · {b.strokes} strokes</span>
            <span className="mt">
              {new Date(b.updatedAt).toLocaleString("en-IN", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" })}
            </span>
            <span
              className="mt"
              role="button"
              tabIndex={0}
              style={{ color: "var(--subtle)", justifySelf: "start" }}
              onClick={(e) => { e.preventDefault(); void remove(b.id, b.title); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void remove(b.id, b.title); } }}
            >
              Delete
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
