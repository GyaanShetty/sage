"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Circle,
  CheckCircle2,
  FileText,
  ListTodo,
  Loader2,
  Plus,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeRise, staggerContainer } from "@/lib/motion";
import { GlassPanel } from "@/components/ui/glass-panel";
import { NoteEditor } from "./note-editor";

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: number;
  dueAt: string | null;
}
export interface NoteRow {
  id: string;
  kind: string;
  title: string;
  content: JSONContent;
  updatedAt: string;
}

type Tab = "tasks" | "notes" | "journal";

export function WorkspaceView({ tasks, notes }: { tasks: TaskRow[]; notes: NoteRow[] }) {
  const [tab, setTab] = useState<Tab>("tasks");
  const [openNote, setOpenNote] = useState<NoteRow | null>(null);
  const [journal, setJournal] = useState<NoteRow | null>(null);
  const [loadingJournal, setLoadingJournal] = useState(false);
  const router = useRouter();

  const openJournal = async () => {
    setTab("journal");
    if (journal) return;
    setLoadingJournal(true);
    const res = await fetch("/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ journal: true }),
    });
    const { data } = await res.json();
    setJournal(data);
    setLoadingJournal(false);
  };

  const newNote = async () => {
    const res = await fetch("/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const { data } = await res.json();
    setOpenNote(data);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.h1 variants={fadeRise} className="text-2xl font-semibold tracking-tight">
          Workspace
        </motion.h1>

        <motion.div variants={fadeRise} className="mt-5 flex gap-2">
          {(
            [
              { id: "tasks", label: "Tasks", icon: ListTodo },
              { id: "notes", label: "Notes", icon: FileText },
              { id: "journal", label: "Journal", icon: BookOpen },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => (id === "journal" ? openJournal() : (setTab(id), setOpenNote(null)))}
              className={cn(
                "flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors",
                tab === id
                  ? "border-border-glass-strong bg-glass-strong text-foreground"
                  : "border-border-glass text-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </motion.div>

        <div className="mt-6">
          <AnimatePresence mode="wait">
            {tab === "tasks" && (
              <motion.div key="tasks" variants={fadeRise} initial="hidden" animate="visible" exit={{ opacity: 0 }}>
                <TasksPanel tasks={tasks} />
              </motion.div>
            )}
            {tab === "notes" && !openNote && (
              <motion.div key="notes" variants={fadeRise} initial="hidden" animate="visible" exit={{ opacity: 0 }}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <button
                    onClick={newNote}
                    className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-glass text-subtle transition-colors hover:border-border-glass-strong hover:text-foreground"
                  >
                    <Plus className="size-5" />
                    <span className="text-sm">New note</span>
                  </button>
                  {notes
                    .filter((n) => n.kind === "doc")
                    .map((note) => (
                      <motion.button
                        key={note.id}
                        whileHover={{ y: -2 }}
                        onClick={() => setOpenNote(note)}
                        className="text-left"
                      >
                        <GlassPanel className="h-32 p-4 transition-colors hover:border-border-glass-strong">
                          <p className="line-clamp-2 text-sm font-medium">{note.title}</p>
                          <p className="mt-1.5 text-xs text-subtle">
                            {new Date(note.updatedAt).toLocaleDateString()}
                          </p>
                        </GlassPanel>
                      </motion.button>
                    ))}
                </div>
              </motion.div>
            )}
            {tab === "notes" && openNote && (
              <motion.div key={openNote.id} variants={fadeRise} initial="hidden" animate="visible" exit={{ opacity: 0 }}>
                <button
                  onClick={() => {
                    setOpenNote(null);
                    router.refresh();
                  }}
                  className="mb-4 flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-4" /> All notes
                </button>
                <NoteEditor
                  noteId={openNote.id}
                  initialTitle={openNote.title}
                  initialContent={openNote.content}
                />
              </motion.div>
            )}
            {tab === "journal" && (
              <motion.div key="journal" variants={fadeRise} initial="hidden" animate="visible" exit={{ opacity: 0 }}>
                {loadingJournal || !journal ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="size-5 animate-spin text-accent" />
                  </div>
                ) : (
                  <NoteEditor
                    key={journal.id}
                    noteId={journal.id}
                    initialTitle={journal.title}
                    initialContent={journal.content}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

function TasksPanel({ tasks: initial }: { tasks: TaskRow[] }) {
  const [tasks, setTasks] = useState(initial);
  const [title, setTitle] = useState("");
  const router = useRouter();

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    const res = await fetch("/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: t }),
    });
    const { data } = await res.json();
    setTasks((prev) => [{ ...data, status: "todo", dueAt: data.dueAt ?? null }, ...prev]);
    router.refresh();
  };

  const toggle = async (task: TaskRow) => {
    const status = task.status === "done" ? "todo" : "done";
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    await fetch(`/api/task/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  };

  const remove = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/task/${id}`, { method: "DELETE" });
    router.refresh();
  };

  const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl border border-border-glass bg-glass px-4 transition-colors focus-within:border-border-glass-strong">
        <Plus className="size-4 shrink-0 text-subtle" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a task…"
          className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
        />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {[...open, ...done].map((task) => (
            <motion.div
              key={task.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -8 }}
            >
              <GlassPanel className="group flex items-center gap-3 px-4 py-3">
                <button onClick={() => toggle(task)} className="shrink-0">
                  {task.status === "done" ? (
                    <CheckCircle2 className="size-[18px] text-accent" />
                  ) : (
                    <Circle className="size-[18px] text-subtle transition-colors hover:text-foreground" />
                  )}
                </button>
                <span
                  className={cn(
                    "flex-1 truncate text-sm",
                    task.status === "done" && "text-subtle line-through",
                  )}
                >
                  {task.title}
                </span>
                {task.dueAt && (
                  <span className="text-xs text-subtle">
                    {new Date(task.dueAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
                <button
                  onClick={() => remove(task.id)}
                  className="rounded-md p-1 text-subtle opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </GlassPanel>
            </motion.div>
          ))}
        </AnimatePresence>
        {tasks.length === 0 && (
          <p className="py-12 text-center text-sm text-subtle">
            No tasks. Add one above or ask SAGE in chat.
          </p>
        )}
      </div>
    </div>
  );
}
