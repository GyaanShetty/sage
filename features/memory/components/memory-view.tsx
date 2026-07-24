"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2, Brain } from "lucide-react";
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

export function MemoryView({ memories }: { memories: MemoryItem[] }) {
  const [filter, setFilter] = useState("all");
  const router = useRouter();
  const visible = memories.filter((m) => filter === "all" || m.type === filter);

  const forget = async (id: string) => {
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    router.refresh();
    // Nudge the Mind Graph to redraw without this memory.
    window.dispatchEvent(new CustomEvent("sage:memory-updated"));
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.h1 variants={fadeRise} className="text-2xl font-semibold tracking-tight">
          Memory
        </motion.h1>
        <motion.p variants={fadeRise} className="mt-1 text-sm text-muted">
          Everything SAGE knows about you. Delete anything — it's your mind, extended.
        </motion.p>

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
                Nothing here yet. Talk to SAGE and it will start remembering.
              </motion.div>
            )}
            {visible.map((memory) => (
              <motion.div
                key={memory.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <GlassPanel className="group flex items-start gap-3 p-4">
                  <span className="mt-0.5 shrink-0 rounded-full border border-border-glass px-2 py-0.5 text-[11px] capitalize text-muted">
                    {memory.type}
                  </span>
                  <p className="flex-1 text-sm leading-relaxed">{memory.content}</p>
                  <button
                    onClick={() => forget(memory.id)}
                    title="Forget"
                    className="rounded-md p-1.5 text-subtle opacity-0 transition-all hover:bg-glass-strong hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </GlassPanel>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
