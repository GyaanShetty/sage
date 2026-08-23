"use client";

import { useState } from "react";
import { Check, MoveRight } from "lucide-react";
import { fmt } from "@/lib/config";
import { sound } from "@/lib/sound";
import { useLive, notifyDataChanged } from "@/lib/live";

interface TickTask { id: string; title: string; projectId: string; projectName: string; dueDate?: string; priority: number; status: number }

// TickTick's Eisenhower convention: priority IS the axis.
const QUADRANTS = [
  { key: "q1", roman: "I", label: "Urgent & Important", sub: "Do first", priority: 5, color: "#e86a6a" },
  { key: "q2", roman: "II", label: "Not Urgent & Important", sub: "Schedule", priority: 3, color: "#e8a13a" },
  { key: "q3", roman: "III", label: "Urgent & Unimportant", sub: "Delegate", priority: 1, color: "#7b8cff" },
  { key: "q4", roman: "IV", label: "Not Urgent & Unimportant", sub: "Eliminate", priority: 0, color: "#54c98a" },
] as const;

function quadrantOf(priority: number): number {
  if (priority >= 5) return 0;
  if (priority >= 3) return 1;
  if (priority >= 1) return 2;
  return 3;
}

/** 09 · MATRIX — the TickTick Eisenhower Matrix, live. Tasks fall into four
 *  quadrants by priority; tap to complete, or reclassify to move a task to a
 *  different quadrant (writes the new priority back to TickTick). */
export function EisenhowerBand() {
  const [tasks, setTasks] = useState<TickTask[] | null | undefined>(undefined);
  const [moving, setMoving] = useState<string | null>(null);

  const load = () =>
    fetch("/api/ticktick").then((r) => r.json()).then((j) => setTasks(j.data)).catch(() => setTasks(null));
  // Same list as the Deadlines band; the shared "tasks" notification is what
  // keeps the two from disagreeing after a tick.
  useLive(load, { everyMs: 120_000, scopes: ["tasks"] });

  const open = (tasks ?? []).filter((t) => t.status !== 2);

  const complete = async (t: TickTask) => {
    sound.blip();
    setTasks((prev) => (prev ? prev.filter((x) => x.id !== t.id) : prev));
    await fetch("/api/ticktick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: t.projectId, taskId: t.id }),
    });
    // Tell the rest of the page, rather than letting each panel discover it
    // on its own timer.
    notifyDataChanged("tasks");
  };

  const reclassify = async (t: TickTask, priority: number) => {
    setMoving(null);
    setTasks((prev) => (prev ? prev.map((x) => (x.id === t.id ? { ...x, priority } : x)) : prev));
    await fetch("/api/ticktick", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: t.projectId, taskId: t.id, priority }),
    }).catch(() => {});
    notifyDataChanged("tasks");
  };

  return (
    <section className="section" id="matrix" style={{ paddingTop: 0 }}>
      <div className="sectitle">
        <span className="sn">09</span><h2>Eisenhower Matrix</h2><span className="line" />
        <span className="tag">TICKTICK · PRIORITIZE BY URGENCY × IMPORTANCE</span>
      </div>

      {tasks === null ? (
        <div className="empty-state" style={{ padding: "28px 0" }}>
          <div className="es-t">TickTick not connected</div>
          <div className="es-d"><a href="/api/integrations/ticktick" className="live">Connect TickTick →</a></div>
        </div>
      ) : (
        <div className="eh-grid">
          {QUADRANTS.map((q, qi) => {
            const items = open.filter((t) => quadrantOf(t.priority) === qi);
            return (
              <div className="eh-quad" key={q.key} style={{ ["--qc" as string]: q.color }}>
                <div className="eh-head">
                  <span className="eh-num" style={{ background: q.color }}>{q.roman}</span>
                  <div className="eh-htext">
                    <span className="eh-label" style={{ color: q.color }}>{q.label}</span>
                    <span className="eh-sub">{q.sub}</span>
                  </div>
                  <span className="eh-count">{items.length}</span>
                </div>
                <div className="eh-list">
                  {tasks === undefined && <p className="lbl" style={{ padding: "8px 0" }}>SYNCING…</p>}
                  {tasks && items.length === 0 && <p className="eh-empty">—</p>}
                  {items.map((t) => (
                    <div className="eh-task" key={t.id}>
                      <button className="eh-check" onClick={() => complete(t)} aria-label="Complete" style={{ borderColor: q.color }}>
                        <Check className="size-3" />
                      </button>
                      <div className="eh-body">
                        <div className="eh-title">{t.title}</div>
                        <div className="eh-meta">
                          {t.dueDate && (
                            <span className="eh-due">
                              {fmt(new Date(t.dueDate), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                            </span>
                          )}
                          <span className="eh-proj">{t.projectName}</span>
                        </div>
                        {moving === t.id && (
                          <div className="eh-move">
                            {QUADRANTS.map((mq, mi) =>
                              mi === qi ? null : (
                                <button key={mq.key} onClick={() => reclassify(t, mq.priority)} style={{ color: mq.color, borderColor: mq.color }}>
                                  {mq.roman}
                                </button>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        className="eh-movebtn"
                        onClick={() => setMoving((m) => (m === t.id ? null : t.id))}
                        title="Move to another quadrant"
                        aria-label="Move"
                      >
                        <MoveRight className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
