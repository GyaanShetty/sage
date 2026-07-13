"use client";

import { motion } from "framer-motion";
import { staggerContainer, fadeRise } from "@/lib/motion";
import { GlassPanel } from "@/components/ui/glass-panel";

const CARDS = [
  { title: "Calendar", body: "Connect Google Calendar to see your day." },
  { title: "Tasks", body: "Nothing due today." },
  { title: "Weather", body: "Set your location in Settings." },
  { title: "Email", body: "Connect Gmail to see unread digests." },
  { title: "GitHub", body: "Connect GitHub to see notifications." },
  { title: "News", body: "Your AI-curated brief will appear here." },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function DashboardView() {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.h1 variants={fadeRise} className="text-2xl font-semibold tracking-tight">
          {greeting()}.
        </motion.h1>
        <motion.p variants={fadeRise} className="mt-1 text-sm text-muted">
          Press <kbd className="rounded border border-border-glass bg-glass px-1.5 py-0.5 font-mono text-xs">⌘K</kbd> to do anything.
        </motion.p>

        <motion.div
          variants={staggerContainer}
          className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {CARDS.map((card) => (
            <motion.div key={card.title} variants={fadeRise} whileHover={{ y: -2, scale: 1.005 }}>
              <GlassPanel className="h-36 p-5 transition-colors hover:border-border-glass-strong">
                <h2 className="text-sm font-medium">{card.title}</h2>
                <p className="mt-2 text-sm text-subtle">{card.body}</p>
              </GlassPanel>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
