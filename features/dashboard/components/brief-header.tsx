"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function BriefHeader() {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/brief")
      .then((r) => r.json())
      .then((j) => setText(j?.data?.text ?? null))
      .catch(() => setText(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mt-5 min-h-[3.5rem]">
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="skeleton" exit={{ opacity: 0 }} className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-glass-strong" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-glass-strong" />
          </motion.div>
        ) : text ? (
          <motion.div
            key="brief"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3 rounded-xl border border-border-glass bg-glass p-4 backdrop-blur-xl"
          >
            <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
            <p className="text-sm leading-relaxed text-muted">{text}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
