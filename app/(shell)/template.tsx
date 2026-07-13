"use client";

import { motion } from "framer-motion";
import { fadeRise } from "@/lib/motion";

/** Premium page transition: every route fades in with a 4px rise. */
export default function ShellTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div variants={fadeRise} initial="hidden" animate="visible" className="h-full">
      {children}
    </motion.div>
  );
}
