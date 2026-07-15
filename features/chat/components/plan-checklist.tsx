"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PlanState {
  goal: string;
  steps: { title: string; done: boolean }[];
}

export function PlanChecklist({ plan }: { plan: PlanState }) {
  const doneCount = plan.steps.filter((s) => s.done).length;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-3 rounded-xl border border-border-glass bg-glass p-4 backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <ListChecks className="size-4 text-accent" />
        <span className="font-medium text-foreground">{plan.goal}</span>
        <span className="ml-auto text-xs text-subtle">
          {doneCount}/{plan.steps.length}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {plan.steps.map((step, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-2.5 text-sm"
          >
            {step.done ? (
              <motion.span initial={{ scale: 0.5 }} animate={{ scale: 1 }}>
                <CheckCircle2 className="size-4 text-accent" />
              </motion.span>
            ) : (
              <Circle className="size-4 text-subtle" />
            )}
            <span className={cn(step.done ? "text-subtle line-through" : "text-muted")}>
              {step.title}
            </span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}
