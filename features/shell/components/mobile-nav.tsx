"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  MessageSquare,
  CandlestickChart,
  ListTodo,
  Settings,
  Boxes,
  Bot,
  Network,
  BookOpen,
  Zap,
  Brain,
  FolderKanban,
  LayoutGrid,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The four primary tabs that stay pinned to the bottom bar.
const TABS = [
  { href: "/dashboard", label: "HOME", icon: LayoutDashboard },
  { href: "/chat", label: "CHAT", icon: MessageSquare },
  { href: "/markets", label: "MARKETS", icon: CandlestickChart },
  { href: "/workspace", label: "TASKS", icon: ListTodo },
];

// Everything else, reachable from the MORE sheet.
const MORE = [
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/lab", label: "Holo-Lab", icon: Boxes },
  { href: "/graph", label: "Mind Graph", icon: Network },
  { href: "/agents", label: "Research Agent", icon: Bot },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/workspace", label: "Workspace", icon: FolderKanban },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Bottom tab bar — phones only; the side rail takes over from md up.
 *  A MORE button opens a full sheet with every remaining page, so mobile
 *  users can reach the whole app without a hidden side rail. */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = MORE.some((m) => pathname.startsWith(m.href)) &&
    !TABS.some((t) => pathname.startsWith(t.href));

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-background/70 backdrop-blur-xl md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="border-t border-border-glass bg-background/95 p-5 pb-8"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 28px)" }}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="lbl !text-[9px] !tracking-[2px] text-subtle">ALL SYSTEMS</span>
                <button onClick={() => setOpen(false)} aria-label="Close" className="text-subtle">
                  <X className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {MORE.map(({ href, label, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link
                      key={label}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex flex-col items-center gap-2 border px-2 py-4 transition-colors",
                        active
                          ? "border-[var(--live)] text-foreground"
                          : "border-border-glass text-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-5" strokeWidth={1.6} />
                      <span className="lbl !text-[8px] !tracking-[1px] text-center" style={{ color: "inherit" }}>
                        {label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-glass bg-background/92 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors",
                active ? "text-foreground" : "text-subtle",
              )}
            >
              {active && <span className="absolute inset-x-6 top-0 h-0.5 bg-[var(--live)]" />}
              <Icon className="size-[18px]" strokeWidth={1.6} />
              <span className="lbl !text-[8px] !tracking-[1.5px]" style={{ color: "inherit" }}>{label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors",
            open || moreActive ? "text-foreground" : "text-subtle",
          )}
        >
          {moreActive && <span className="absolute inset-x-6 top-0 h-0.5 bg-[var(--live)]" />}
          <LayoutGrid className="size-[18px]" strokeWidth={1.6} />
          <span className="lbl !text-[8px] !tracking-[1.5px]" style={{ color: "inherit" }}>MORE</span>
        </button>
      </nav>
    </>
  );
}
