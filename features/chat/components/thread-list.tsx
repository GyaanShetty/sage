"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThreadRow } from "@/infrastructure/db/threads";

export function ThreadList({ threads, activeId }: { threads: ThreadRow[]; activeId: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const newChat = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/thread", { method: "POST" });
      const { data } = await res.json();
      router.push(`/chat?t=${data.id}`);
      router.refresh();
    } finally {
      setCreating(false);
    }
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--rule-strong)]">
      {/* The rail names the column, so the sidebar reads as part of the
          instrument rather than as an unlabelled list floating at the edge. */}
      <div className="rail border-b border-[var(--rule)] px-3 py-2.5">
        <span className="k">SESSIONS</span>
        <span className="sep" />
        <span className="v">{threads.length}</span>
      </div>
      <div className="p-3">
        <button
          onClick={newChat}
          disabled={creating}
          className="flex h-8 w-full items-center justify-center gap-2 border border-[var(--rule)] font-[family-name:var(--mono)] text-[9px] uppercase tracking-[0.16em] text-subtle transition-colors hover:border-[var(--signal-dim)] hover:text-[var(--signal)]"
        >
          {creating ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
          NEW SESSION
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {threads.map((thread, i) => (
          <motion.div
            key={thread.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
          >
            <Link
              href={`/chat?t=${thread.id}`}
              className={cn(
                "block truncate border-l-2 px-3 py-1.5 text-[13px] transition-colors",
                thread.id === activeId
                  ? "border-[var(--signal)] bg-[var(--signal-faint)] text-foreground"
                  : "border-transparent text-muted hover:border-[var(--rule-strong)] hover:text-foreground",
              )}
            >
              {thread.title ?? "Untitled"}
            </Link>
          </motion.div>
        ))}
      </nav>
    </aside>
  );
}
