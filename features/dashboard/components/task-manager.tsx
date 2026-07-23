"use client";

import { useState } from "react";
import { Check, Pencil, Trash2, Plus } from "lucide-react";
import type { TaskRow } from "./command-view";
import { sound } from "@/lib/sound";

/** Full task CRUD, shown inside the expand modal. */
export function TaskManager({ tasks, setTasks }: { tasks: TaskRow[]; setTasks: (fn: (prev: TaskRow[]) => TaskRow[]) => void }) {
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const res = await fetch("/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const { data } = await res.json();
    if (data?.id) {
      sound.blip();
      setTasks((prev) => [{ id: data.id, title, status: "todo", dueAt: null }, ...prev]);
    }
  };

  const toggle = async (t: TaskRow) => {
    const status = t.status === "done" ? "todo" : "done";
    if (status === "done") sound.blip();
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status } : x)));
    await fetch(`/api/task/${t.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
  };

  const remove = async (id: string) => {
    setTasks((prev) => prev.filter((x) => x.id !== id));
    await fetch(`/api/task/${id}`, { method: "DELETE" });
  };

  const saveEdit = async (id: string) => {
    const title = editText.trim();
    setEditId(null);
    if (!title) return;
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, title } : x)));
    await fetch(`/api/task/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
  };

  return (
    <div className="tm-wrap">
      <div className="tm-add">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="New directive…"
          autoFocus
        />
        <button onClick={add} aria-label="Add"><Plus className="size-4" /> ADD</button>
      </div>

      <div className="tm-list">
        {tasks.length === 0 && <p className="lbl" style={{ padding: "20px 0" }}>NO DIRECTIVES. ADD ONE ABOVE.</p>}
        {tasks.map((t) => (
          <div className={`tm-row${t.status === "done" ? " done" : ""}`} key={t.id}>
            <button className="tm-check" onClick={() => toggle(t)} aria-label="Toggle">
              {t.status === "done" && <Check className="size-3" />}
            </button>
            {editId === t.id ? (
              <input
                className="tm-edit"
                value={editText}
                autoFocus
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t.id); if (e.key === "Escape") setEditId(null); }}
                onBlur={() => saveEdit(t.id)}
              />
            ) : (
              <span className="tm-title" onClick={() => { setEditId(t.id); setEditText(t.title); }}>{t.title}</span>
            )}
            <button className="tm-ic" onClick={() => { setEditId(t.id); setEditText(t.title); }} aria-label="Edit"><Pencil className="size-3.5" /></button>
            <button className="tm-ic danger" onClick={() => remove(t.id)} aria-label="Delete"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
