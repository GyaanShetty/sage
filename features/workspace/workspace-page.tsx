"use client";

/**
 * The work, as one list.
 *
 * Tasks ranked the way SAGE already ranks them — the matrix endpoint does
 * urgency and importance from the due date and priority you already set, so
 * this is a view of the task list rather than a second opinion about it.
 *
 * Add at the top, because the thing you came here to do is usually to write
 * something down before it escapes.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Frame } from "@/features/home/frame";
import { asArray } from "@/lib/as-array";
import { invalidate } from "@/lib/share";

interface Task { id: string; title: string; dueAt: string | null; hoursToDue: number | null }

const SECTIONS = [
  { key: "do", label: "Do now", hint: "urgent and important" },
  { key: "schedule", label: "Schedule", hint: "important, not urgent" },
  { key: "delegate", label: "Delegate", hint: "urgent, not important" },
  { key: "drop", label: "Drop", hint: "neither" },
] as const;

function when(t: Task): string {
  if (t.hoursToDue === null) return "";
  if (t.hoursToDue < 0) return "overdue";
  if (t.hoursToDue < 1) return "now";
  if (t.hoursToDue < 24) return `${Math.round(t.hoursToDue)}h`;
  const d = Math.round(t.hoursToDue / 24);
  return d === 1 ? "tomorrow" : `${d}d`;
}

export function WorkspacePage() {
  const [grid, setGrid] = useState<Record<string, Task[]> | null>(null);
  const [title, setTitle] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    // Straight fetch rather than the shared cache: this page is the one place
    // a stale list is actually wrong, because you are editing it.
    fetch("/api/task/matrix", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setGrid((j?.data ?? {}) as Record<string, Task[]>))
      .catch(() => setGrid({}));
  }, []);
  useEffect(load, [load]);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await fetch("/api/task", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: t }),
    }).catch(() => {});
    invalidate("/api/task/matrix");
    load();
  };

  const complete = async (id: string) => {
    setDone((d) => new Set(d).add(id));
    await fetch(`/api/task/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    }).catch(() => setDone((d) => { const n = new Set(d); n.delete(id); return n; }));
    invalidate("/api/task/matrix");
  };

  const empty = grid && SECTIONS.every((s) => (grid[s.key] ?? []).length === 0);

  return (
    <Frame title="Workspace">
      <div className="ask" style={{ marginBottom: "var(--s6)" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          placeholder="Add a task"
          aria-label="Add a task"
        />
        {title.trim() && (
          <button className="btn btn-accent" onClick={add} aria-label="Add"><Plus className="size-4" /></button>
        )}
      </div>

      {grid === null && <p className="quiet">Loading…</p>}
      {empty && <p className="quiet">Nothing open. Add something above.</p>}

      {grid && SECTIONS.map((s) => {
        const items = asArray<Task>(grid[s.key]);
        if (!items.length) return null;
        return (
          <section key={s.key}>
            <div className="sec-h">
              <h2>{s.label}</h2>
              <span className="sec-hint">{s.hint}</span>
            </div>
            <div className="rows">
              {items.map((t) => (
                <button key={t.id} className="row" onClick={() => complete(t.id)} disabled={done.has(t.id)}>
                  <span className={`tick${done.has(t.id) ? " on" : ""}`} aria-hidden>
                    {done.has(t.id) && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="row-main">
                    <span className="row-t" style={done.has(t.id) ? { textDecoration: "line-through", opacity: 0.4 } : undefined}>
                      {t.title}
                    </span>
                  </span>
                  <span className={`row-v${t.hoursToDue !== null && t.hoursToDue < 0 ? " down" : ""}`}>{when(t)}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </Frame>
  );
}
