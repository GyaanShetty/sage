"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2, Brain, Plus, Pencil, Check, X, Pin, PinOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { staggerContainer, fadeRise } from "@/lib/motion";
import { GlassPanel } from "@/components/ui/glass-panel";

export interface MemoryItem {
  id: string;
  type: string;
  content: string;
  confidence: number;
  importance: number;
  createdAt: string;
}

const TYPES = ["all", "fact", "preference", "goal", "routine", "skill", "relationship", "episode"];
const EDIT_TYPES = TYPES.filter((t) => t !== "all");
const PIN_AT = 0.9;

export function MemoryView({ memories }: { memories: MemoryItem[] }) {
  const [filter, setFilter] = useState("all");
  const router = useRouter();

  // Add composer
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [newType, setNewType] = useState("fact");
  const [busy, setBusy] = useState(false);

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editType, setEditType] = useState("fact");

  const nudge = () => window.dispatchEvent(new CustomEvent("sage:memory-updated"));

  const pinnedFirst = [...memories].sort(
    (a, b) => (b.importance >= PIN_AT ? 1 : 0) - (a.importance >= PIN_AT ? 1 : 0),
  );
  const visible = pinnedFirst.filter((m) => filter === "all" || m.type === filter);

  const add = async () => {
    const content = newText.trim();
    if (!content || busy) return;
    setBusy(true);
    await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, type: newType }),
    });
    setBusy(false);
    setNewText("");
    setAdding(false);
    router.refresh();
    nudge();
  };

  const startEdit = (m: MemoryItem) => {
    setEditId(m.id);
    setEditText(m.content);
    setEditType(m.type);
  };

  const saveEdit = async () => {
    if (!editId || !editText.trim()) return;
    setBusy(true);
    await fetch(`/api/memory/${editId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: editText.trim(), type: editType }),
    });
    setBusy(false);
    setEditId(null);
    router.refresh();
    nudge();
  };

  const togglePin = async (m: MemoryItem) => {
    const importance = m.importance >= PIN_AT ? 0.5 : 1;
    await fetch(`/api/memory/${m.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ importance }),
    });
    router.refresh();
  };

  const forget = async (id: string) => {
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    router.refresh();
    nudge();
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:px-8">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.div variants={fadeRise} className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
            <p className="mt-1 text-sm text-muted">
              Everything SAGE knows about you. Add, edit, pin, or forget — it's your mind, extended.
            </p>
          </div>
          <button
            onClick={() => setAdding((a) => !a)}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-border-glass px-3 py-2 text-xs text-muted transition-colors hover:border-border-glass-strong hover:text-foreground"
          >
            <Plus className="size-3.5" /> Add
          </button>
        </motion.div>

        <AnimatePresence>
          {adding && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <GlassPanel className="mt-4 space-y-3 p-4">
                <textarea
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  placeholder="Tell SAGE something to remember — e.g. 'I train Muay Thai on Tuesdays and Thursdays.'"
                  rows={2}
                  className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-subtle"
                  autoFocus
                />
                <div className="flex items-center justify-between gap-2">
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="h-9 rounded-lg border border-border-glass bg-background px-2 text-xs capitalize outline-none"
                  >
                    {EDIT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <button
                    onClick={add}
                    disabled={busy || !newText.trim()}
                    className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity disabled:opacity-30"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    Remember
                  </button>
                </div>
              </GlassPanel>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div variants={fadeRise} className="mt-6 flex flex-wrap gap-2">
          {TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs capitalize transition-colors",
                filter === type
                  ? "border-border-glass-strong bg-glass-strong text-foreground"
                  : "border-border-glass text-muted hover:text-foreground",
              )}
            >
              {type}
            </button>
          ))}
        </motion.div>

        <div className="mt-6 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {visible.length === 0 && (
              <motion.div variants={fadeRise} className="py-16 text-center text-sm text-subtle">
                <Brain className="mx-auto mb-3 size-6 opacity-40" />
                Nothing here yet. Add a memory above, or talk to SAGE and it will start remembering.
              </motion.div>
            )}
            {visible.map((memory) => {
              const pinned = memory.importance >= PIN_AT;
              const editing = editId === memory.id;
              return (
                <motion.div
                  key={memory.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                >
                  <GlassPanel className={cn("group flex items-start gap-3 p-4", pinned && "border-[var(--live-dim)]")}>
                    {editing ? (
                      <div className="flex-1 space-y-2">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={2}
                          className="w-full resize-none rounded-lg border border-border-glass bg-transparent p-2 text-sm outline-none focus:border-border-glass-strong"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value)}
                            className="h-8 rounded-lg border border-border-glass bg-background px-2 text-xs capitalize outline-none"
                          >
                            {EDIT_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <button onClick={saveEdit} disabled={busy} className="flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-40">
                            <Check className="size-3.5" /> Save
                          </button>
                          <button onClick={() => setEditId(null)} className="rounded-md p-1.5 text-subtle hover:text-foreground">
                            <X className="size-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="mt-0.5 shrink-0 rounded-full border border-border-glass px-2 py-0.5 text-[11px] capitalize text-muted">
                          {memory.type}
                        </span>
                        <p className="flex-1 text-sm leading-relaxed">{memory.content}</p>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            onClick={() => togglePin(memory)}
                            title={pinned ? "Unpin" : "Pin (prioritize)"}
                            className={cn(
                              "rounded-md p-1.5 transition-all hover:bg-glass-strong",
                              pinned ? "text-[var(--live)]" : "text-subtle opacity-0 group-hover:opacity-100 hover:text-foreground",
                            )}
                          >
                            {pinned ? <Pin className="size-4" /> : <PinOff className="size-4" />}
                          </button>
                          <button
                            onClick={() => startEdit(memory)}
                            title="Edit"
                            className="rounded-md p-1.5 text-subtle opacity-0 transition-all hover:bg-glass-strong hover:text-foreground group-hover:opacity-100"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            onClick={() => forget(memory.id)}
                            title="Forget"
                            className="rounded-md p-1.5 text-subtle opacity-0 transition-all hover:bg-glass-strong hover:text-red-400 group-hover:opacity-100"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </GlassPanel>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
