"use client";

import { useEffect, useState } from "react";
import { CheckSquare, ListChecks } from "lucide-react";
import { ExpandableCell } from "./expandable-cell";
import { fmt } from "@/lib/config";
import { sound } from "@/lib/sound";

interface TickTask { id: string; title: string; projectId: string; projectName: string; dueDate?: string; priority: number; status: number }

const PRI = (p: number) => (p >= 5 ? "HIGH" : p >= 3 ? "MED" : p >= 1 ? "LOW" : "");

function List({ tasks, onDone }: { tasks: TickTask[]; onDone: (t: TickTask) => void }) {
  return (
    <>
      {tasks.map((t) => (
        <div className="tt-row" key={t.id}>
          <button className="tt-check" onClick={() => onDone(t)} aria-label="Complete"><CheckSquare className="size-3.5" /></button>
          <div className="tt-main">
            <div className="tt-title">{t.title}</div>
            <div className="tt-meta">
              <span>{t.projectName}</span>
              {t.dueDate && <span className="tt-due">{fmt(new Date(t.dueDate), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</span>}
              {PRI(t.priority) && <span className={`tt-pri p${t.priority}`}>{PRI(t.priority)}</span>}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/** 10 · DEADLINES — TickTick tasks & deadlines, with one-tap complete. */
export function TickTickBand() {
  const [tasks, setTasks] = useState<TickTask[] | null | undefined>(undefined);

  const load = () => fetch("/api/ticktick").then((r) => r.json()).then((j) => setTasks(j.data)).catch(() => setTasks(null));
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, []);

  const complete = async (t: TickTask) => {
    sound.blip();
    setTasks((prev) => (prev ? prev.filter((x) => x.id !== t.id) : prev));
    await fetch("/api/ticktick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: t.projectId, taskId: t.id }) });
  };

  const open = (tasks ?? []).filter((t) => t.status !== 2);

  return (
    <section className="section" id="deadlines" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">10</span><h2>Deadlines</h2><span className="line" /><span className="tag">TICKTICK · TASKS &amp; DUE DATES</span></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <ExpandableCell title="Deadlines" tag="TICKTICK" expanded={<div className="tt-list"><List tasks={open} onDone={complete} /></div>}>
          <div className="bh"><span className="t">TickTick</span><span className="i">TCK</span><span className="r">{tasks === undefined ? "SYNCING" : tasks === null ? "OFFLINE" : `${open.length} OPEN`}</span></div>
          {tasks === undefined && <p className="lbl">SYNCING…</p>}
          {tasks === null && (
            <div className="empty-state">
              <ListChecks className="es-mark size-5" strokeWidth={1.5} />
              <div className="es-t">TickTick not connected</div>
              <div className="es-d"><a href="/api/integrations/ticktick" className="live">Connect TickTick →</a></div>
            </div>
          )}
          {tasks && open.length === 0 && <div className="empty-state"><div className="es-t">All clear</div><div className="es-d">No open TickTick tasks</div></div>}
          {tasks && open.length > 0 && <div className="tt-list"><List tasks={open.slice(0, 6)} onDone={complete} /></div>}
        </ExpandableCell>
      </div>
    </section>
  );
}
