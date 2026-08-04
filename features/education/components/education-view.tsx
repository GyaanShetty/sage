"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, GraduationCap, Loader2, NotebookPen, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/features/dashboard/command.css";
import { StudyLog } from "./study-log";

interface Skill {
  id: string; name: string; category: string;
  level: number; target: number; notes?: string;
  lastPractisedAt?: string; updatedAt: string;
}
interface Summary {
  total: number;
  byCategory: Record<string, { count: number; level: number; target: number }>;
  gaps: { id: string; name: string; category: string; level: number; target: number; gap: number }[];
  rusty: { id: string; name: string; days: number }[];
  averageLevel: number;
}

const LEVELS = ["untouched", "aware", "practising", "competent", "fluent", "teaching"];

/** Six rungs, clickable. Levels beat a percentage here: a slider invites false
 *  precision about something nobody measures that finely. */
function Ladder({ level, target, onSet }: { level: number; target: number; onSet?: (n: number) => void }) {
  return (
    <div className="ed-ladder" title={`${LEVELS[level]} · target ${LEVELS[target]}`}>
      {Array.from({ length: 6 }).map((_, i) => (
        <button
          key={i}
          onClick={() => onSet?.(i)}
          disabled={!onSet}
          aria-label={`Set to ${LEVELS[i]}`}
          className={cn(
            "ed-rung",
            i <= level && "on",
            i > level && i <= target && "want",
          )}
        />
      ))}
    </div>
  );
}

export function EducationView() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  // Which skill's study log is open — one at a time, so the page stays a list.
  const [logId, setLogId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", category: "", target: 3 });
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", category: "", notes: "" });

  const load = useCallback(async () => {
    const j = await fetch("/api/skills").then((r) => r.json()).catch(() => null);
    setSkills(j?.ok ? j.data : []);
    setSummary(j?.summary ?? null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    await fetch("/api/skills", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    await load();
  };

  const add = async () => {
    if (!draft.name.trim()) return;
    await save({ name: draft.name, category: draft.category || "General", target: draft.target });
    setDraft({ name: "", category: draft.category, target: draft.target });
    setAdding(false);
  };

  const remove = async (id: string) => {
    // Optimistic: the row vanishes immediately, which is what a delete should
    // feel like even on a slow connection.
    setSkills((s) => s?.filter((x) => x.id !== id) ?? s);
    await fetch(`/api/skills?id=${id}`, { method: "DELETE" }).catch(() => null);
    await load();
  };

  const grouped = useMemo(() => {
    const g: Record<string, Skill[]> = {};
    for (const s of skills ?? []) (g[s.category] ??= []).push(s);
    for (const list of Object.values(g)) list.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [skills]);

  const categories = useMemo(
    () => [...new Set((skills ?? []).map((s) => s.category))].sort(),
    [skills],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="hud-label">SKILL LEDGER</p>
          <h1 className="brand-title mt-1 text-[26px] md:text-[32px]">Education</h1>
          <p className="mt-1 max-w-lg text-sm text-muted">
            What you know, how well, and what you meant to know by now. Categories are
            yours to invent — nothing here is a fixed syllabus.
          </p>
        </div>
        <button
          onClick={() => setAdding((a) => !a)}
          className="hud-label flex items-center gap-2 border border-border-glass px-4 py-2 transition-colors hover:border-border-glass-strong hover:!text-foreground"
        >
          <Plus className="size-3.5" /> ADD SKILL
        </button>
      </div>

      {summary && summary.total > 0 && (
        <div className="rp-stats mt-5">
          <div className="rp-stat">
            <div className="rp-stat-v num">{summary.total}</div>
            <div className="rp-stat-k">Skills tracked</div>
          </div>
          <div className="rp-stat">
            <div className="rp-stat-v num">{summary.averageLevel}</div>
            <div className="rp-stat-k">Average level</div>
            <div className="rp-stat-s">of 5</div>
          </div>
          <div className="rp-stat">
            <div className="rp-stat-v num">{summary.gaps.length}</div>
            <div className="rp-stat-k">Below target</div>
          </div>
          <div className="rp-stat">
            <div className="rp-stat-v num">{summary.rusty.length}</div>
            <div className="rp-stat-k">Going rusty</div>
            <div className="rp-stat-s">3+ weeks untouched</div>
          </div>
        </div>
      )}

      {adding && (
        <div className="mono-grid mt-4 grid-cols-1">
          <div className="flex flex-wrap items-center gap-2 p-4">
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Dynamic programming"
              className="h-9 flex-1 border border-border-glass bg-transparent px-3 font-mono text-sm outline-none focus:border-border-glass-strong"
            />
            <input
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="DSA"
              list="ed-cats"
              className="h-9 w-40 border border-border-glass bg-transparent px-3 font-mono text-sm outline-none focus:border-border-glass-strong"
            />
            <datalist id="ed-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <span className="hud-label">TARGET</span>
            <Ladder level={-1} target={draft.target} onSet={(n) => setDraft((d) => ({ ...d, target: n }))} />
            <button
              onClick={add}
              disabled={busy || !draft.name.trim()}
              className="hud-label flex items-center gap-2 bg-foreground px-4 py-2 !text-background disabled:opacity-30"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} ADD
            </button>
          </div>
        </div>
      )}

      {skills === null && <p className="mt-10 text-center text-sm text-subtle">Loading…</p>}
      {skills?.length === 0 && !adding && (
        <div className="mt-16 text-center text-sm text-subtle">
          <GraduationCap className="mx-auto mb-3 size-6 opacity-40" />
          Nothing tracked yet. Add DSA, DBMS, Operating Systems — or whatever you are
          actually working on.
        </div>
      )}

      {summary && summary.gaps.length > 0 && (
        <div className="mono-grid mt-5 grid-cols-1">
          <div className="p-4">
            <p className="hud-label">BIGGEST GAPS TO TARGET</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {summary.gaps.map((g) => (
                <span key={g.id} className="ed-gap">
                  {g.name}
                  <b>+{g.gap}</b>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {grouped.map(([category, list]) => (
        <div key={category} className="mt-5">
          <div className="sectitle" style={{ marginBottom: 8 }}>
            <span className="sn">{category.slice(0, 3).toUpperCase()}</span>
            <h2>{category}</h2>
            <span className="line" />
            <span className="tag">{list.length}</span>
          </div>
          <div className="mono-grid grid-cols-1">
            {list.map((s) => (
              <div key={s.id} className="group p-3">
                {editId === s.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                      className="h-9 flex-1 border border-border-glass bg-transparent px-3 font-mono text-sm outline-none"
                    />
                    <input
                      value={editDraft.category}
                      onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value }))}
                      list="ed-cats"
                      className="h-9 w-40 border border-border-glass bg-transparent px-3 font-mono text-sm outline-none"
                    />
                    <button
                      onClick={async () => { await save({ id: s.id, ...editDraft }); setEditId(null); }}
                      className="hud-label bg-foreground px-3 py-2 !text-background"
                    >
                      SAVE
                    </button>
                    <button onClick={() => setEditId(null)} className="p-2 text-subtle hover:text-foreground">
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => { setEditId(s.id); setEditDraft({ name: s.name, category: s.category, notes: s.notes ?? "" }); }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm">{s.name}</span>
                      <span className="hud-label mt-0.5 block">
                        {LEVELS[s.level].toUpperCase()}
                        {s.target > s.level && ` → ${LEVELS[s.target].toUpperCase()}`}
                        {s.lastPractisedAt &&
                          ` · ${Math.floor((Date.now() - new Date(s.lastPractisedAt).getTime()) / 86_400_000)}D AGO`}
                      </span>
                    </button>
                    <Ladder level={s.level} target={s.target} onSet={(n) => save({ id: s.id, level: n })} />
                    <button
                      onClick={() => setLogId((id) => (id === s.id ? null : s.id))}
                      title="Study log — sessions, notes, links, open questions"
                      className={cn("p-1.5 transition-colors", logId === s.id ? "text-live" : "text-subtle hover:text-foreground")}
                    >
                      <NotebookPen className="size-4" />
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      title="Remove"
                      className="p-1.5 text-subtle opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                )}

                {logId === s.id && <StudyLog skillId={s.id} skillName={s.name} />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
