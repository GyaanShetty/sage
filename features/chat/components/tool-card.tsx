"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Wrench, XCircle } from "lucide-react";

const LABELS: Record<string, string> = {
  create_task: "Creating task",
  list_tasks: "Checking your tasks",
  complete_task: "Completing task",
  remember: "Saving to memory",
};

export function ToolCard({
  name,
  state,
  output,
}: {
  name: string;
  state: string;
  output?: unknown;
}) {
  const done = state === "output-available";
  const failed =
    state === "output-error" || (done && !!output && (output as { ok?: boolean }).ok === false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 inline-flex items-center gap-2.5 rounded-lg border border-border-glass bg-glass px-3 py-2 text-[13px] text-muted"
    >
      {failed ? (
        <XCircle className="size-4 text-red-400" />
      ) : done ? (
        <CheckCircle2 className="size-4 text-accent" />
      ) : (
        <Loader2 className="size-4 animate-spin text-accent" />
      )}
      <Wrench className="size-3.5 opacity-50" />
      <span>{LABELS[name] ?? name}</span>
    </motion.div>
  );
}
