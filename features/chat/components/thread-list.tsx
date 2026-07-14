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
    <aside className="flex w-60 shrink-0 flex-col border-r border-border-glass">
      <div className="p-3">
        <button
          onClick={newChat}
          disabled={creating}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border-glass bg-glass text-sm text-muted transition-colors hover:border-border-glass-strong hover:text-foreground"
        >
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          New chat
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
                "block truncate rounded-lg px-3 py-2 text-sm transition-colors",
                thread.id === activeId
                  ? "bg-glass-strong text-foreground"
                  : "text-muted hover:bg-glass hover:text-foreground",
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
