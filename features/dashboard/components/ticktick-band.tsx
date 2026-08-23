"use client";

import { useEffect, useState } from "react";
import { CheckSquare, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";
import { ExpandableCell } from "./expandable-cell";
import { fmt } from "@/lib/config";
import { sound } from "@/lib/sound";

interface TickTask { id: string; title: string; projectId: string; projectName: string; dueDate?: string; priority: number; status: number }

const PRI = (p: number) => (p >= 5 ? "HIGH" : p >= 3 ? "MED" : p >= 1 ? "LOW" : "");

function List({
  tasks,
  onDone,
  onRemove,
}: {
  tasks: TickTask[];
  onDone: (t: TickTask) => void;
  onRemove: (t: TickTask) => void;
}) {
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
          {/* Deleting and completing are different intentions; a task added by
              mistake should not have to be ticked off as though it were done. */}
          <button className="tt-del" onClick={() => onRemove(t)} aria-label="Delete" title="Delete">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </>
  );
}

/** 10 · DEADLINES — TickTick tasks & deadlines, with one-tap complete. */
export function TickTickBand() {
  const [tasks, setTasks] = useState<TickTask[] | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [due, setDue] = useState("");
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const load = () => fetch("/api/ticktick").then((r) => r.json()).then((j) => setTasks(j.data)).catch(() => setTasks(null));

  useEffect(() => {
    load();
    const t = setInterval(load, 120000);

    /**
     * Refresh on the way back in.
     *
     * A two-minute timer is fine for a list nobody is touching, and wrong for
     * this one: the usual way a task disappears is that it was ticked off in
     * the TickTick app, and the usual way you find out is by looking at SAGE
     * immediately afterwards. Returning to the tab is the strongest possible
     * signal that the list is about to be read.
     */
    const onFocus = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const complete = async (t: TickTask) => {
    sound.blip();
    // Optimistic: the row goes now, because waiting on a round trip to tick
    // something off feels broken.
    setTasks((prev) => (prev ? prev.filter((x) => x.id !== t.id) : prev));
    const res = await fetch("/api/ticktick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: t.projectId, taskId: t.id }),
    }).then((r) => r.json()).catch(() => null);

    // But optimism has to be paid back. This used to ignore the outcome
    // entirely, so a completion TickTick refused still cleared the row and the
    // task silently returned on the next poll two minutes later.
    if (!res?.ok) { setAddErr(res?.error ?? "TickTick didn't take that."); load(); return; }
    load();
  };

  const remove = async (t: TickTask) => {
    setTasks((prev) => (prev ? prev.filter((x) => x.id !== t.id) : prev));
    const res = await fetch("/api/ticktick", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: t.projectId, taskId: t.id }),
    }).then((r) => r.json()).catch(() => null);
    if (!res?.ok) setAddErr(res?.error ?? "Couldn't delete that.");
    load();
  };

  const open = (tasks ?? []).filter((t) => t.status !== 2);

  const add = async (title: string, dueAt: string | null) => {
    setAdding(true); setAddErr(null);
    const res = await fetch("/api/ticktick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}) }),
    }).then((r) => r.json()).catch(() => null);
    setAdding(false);
    if (!res?.ok) { setAddErr(res?.error ?? "Couldn't add that."); return; }
    setDraft(""); setDue("");
    sound.blip();
    load();   // pull it back from TickTick rather than guessing the shape
  };

  const AddBox = (
    <form
      onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void add(draft.trim(), due || null); }}
      className="tt-add"
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add a task to TickTick…"
        className="tt-addinput"
      />
      <input
        type="datetime-local"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        title="Due date (optional)"
        className="tt-adddue"
      />
      <button type="submit" disabled={adding || !draft.trim()} className="tt-addbtn" aria-label="Add">
        {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
      </button>
    </form>
  );

  return (
    <section className="section" id="deadlines" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">10</span><h2>Deadlines</h2><span className="line" /><span className="tag">TICKTICK · TASKS &amp; DUE DATES</span></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        <ExpandableCell title="Deadlines" tag="TICKTICK" expanded={<div className="tt-list">{tasks !== null && AddBox}{addErr && <p className="tt-adderr">{addErr}</p>}<List tasks={open} onDone={complete} onRemove={remove} /></div>}>
          <div className="bh"><span className="t">TickTick</span><span className="i">TCK</span><span className="r">{tasks === undefined ? "SYNCING" : tasks === null ? "OFFLINE" : `${open.length} OPEN`}</span></div>
          {tasks === undefined && <p className="lbl">SYNCING…</p>}
          {tasks === null && (
            <div className="empty-state">
              <ListChecks className="es-mark size-5" strokeWidth={1.5} />
              <div className="es-t">TickTick not connected</div>
              <div className="es-d"><a href="/api/integrations/ticktick" className="live">Connect TickTick →</a></div>
            </div>
          )}
          {tasks && (
            <div className="tt-list">
              {AddBox}
              {addErr && <p className="tt-adderr">{addErr}</p>}
              {open.length === 0
                ? <div className="es-d" style={{ padding: "8px 0" }}>All clear — nothing open.</div>
                : <List tasks={open.slice(0, 6)} onDone={complete} onRemove={remove} />}
            </div>
          )}
        </ExpandableCell>
      </div>
    </section>
  );
}
