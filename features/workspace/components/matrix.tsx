"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Loader2, Pin } from "lucide-react";
import { cn } from "@/lib/utils";

type Quadrant = "do" | "schedule" | "delegate" | "drop";

interface MatrixTask {
  id: string; title: string; priority: number; dueAt: string | null;
  quadrant: Quadrant; pinned: boolean; urgent: boolean; important: boolean;
  hoursToDue: number | null; estimateMin?: number; tags?: string[];
}

const ORDER: Quadrant[] = ["do", "schedule", "delegate", "drop"];
const META: Record<Quadrant, { label: string; hint: string }> = {
  do: { label: "Do now", hint: "urgent · important" },
  schedule: { label: "Schedule", hint: "important, not urgent" },
  delegate: { label: "Delegate", hint: "urgent, not important" },
  drop: { label: "Drop", hint: "neither — cut it" },
};

/** Human-readable time to deadline. "-3h" is a puzzle; "3h overdue" is not. */
function due(h: number | null): string | null {
  if (h === null) return null;
  if (h < 0) {
    const over = Math.abs(h);
    return over < 24 ? `${Math.round(over)}h overdue` : `${Math.round(over / 24)}d overdue`;
  }
  if (h < 1) return "due within the hour";
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export function EisenhowerMatrix() {
  const [grid, setGrid] = useState<Record<Quadrant, MatrixTask[]> | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/task/matrix").then((r) => r.json()).catch(() => null);
    if (j?.ok) setGrid(j.data);
    else setGrid({ do: [], schedule: [], delegate: [], drop: [] });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const move = async (taskId: string, quadrant: Quadrant) => {
    setMoving(taskId);
    const j = await fetch("/api/task/matrix", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId, quadrant }),
    }).then((r) => r.json()).catch(() => null);
    if (j?.ok) setGrid(j.data);
    setMoving(null);
    setDragging(null);
  };

  const total = grid ? ORDER.reduce((n, q) => n + grid[q].length, 0) : 0;

  return (
    <div className="mt-6">
      <div className="sectitle" style={{ marginBottom: 10 }}>
        <span className="sn">EIS</span>
        <h2>Matrix</h2>
        <span className="line" />
        <span className="tag">{total} OPEN</span>
      </div>

      {grid === null && <p className="text-sm text-subtle">Loading…</p>}
      {grid && total === 0 && (
        <p className="text-sm text-subtle">
          Nothing open. The grid fills itself from priority and due dates — no sorting required.
        </p>
      )}

      {grid && total > 0 && (
        <div className="eis-grid">
          {ORDER.map((q) => (
            <div
              key={q}
              className={cn("eis-cell", `eis-${q}`, dragging && "drop-target")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                if (id) void move(id, q);
              }}
            >
              <div className="eis-head">
                <span className="eis-label">{META[q].label}</span>
                <span className="eis-hint">{META[q].hint}</span>
                <span className="eis-count">{grid[q].length}</span>
              </div>

              <div className="eis-list">
                {grid[q].length === 0 && <p className="eis-empty">—</p>}
                {grid[q].map((t) => {
                  const d = due(t.hoursToDue);
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); setDragging(t.id); }}
                      onDragEnd={() => setDragging(null)}
                      className={cn("eis-task", moving === t.id && "busy")}
                    >
                      <span className="eis-title">{t.title}</span>
                      <span className="eis-meta">
                        {t.pinned && <Pin className="size-2.5" />}
                        {d && <b className={cn(t.hoursToDue !== null && t.hoursToDue < 0 && "late")}>{d}</b>}
                        {t.estimateMin ? <i><Clock className="size-2.5" /> {t.estimateMin}m</i> : null}
                        {moving === t.id && <Loader2 className="size-2.5 animate-spin" />}
                      </span>
                      {/* Drag is the fast path; these are the accessible one, and
                          the only one that works on a phone. */}
                      <span className="eis-move">
                        {ORDER.filter((x) => x !== q).map((x) => (
                          <button key={x} onClick={() => move(t.id, x)} title={`Move to ${META[x].label}`}>
                            {META[x].label.split(" ")[0]}
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
