"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  MessageSquare,
  FolderKanban,
  BookOpen,
  Zap,
  Brain,
  Settings,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";
import { APP_NAME } from "@/lib/config";
import { useShellStore } from "../store";
import { SageMark } from "@/components/ui/sage-mark";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/workspace", label: "Workspace", icon: FolderKanban },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/memory", label: "Memory", icon: Brain },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const expanded = useShellStore((s) => s.sidebarExpanded);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);

  return (
    <motion.aside
      animate={{ width: expanded ? 240 : 64 }}
      transition={springs.smooth}
      className="hidden h-full shrink-0 flex-col border-r border-border-glass bg-glass backdrop-blur-xl md:flex"
    >
      <div className="flex h-14 items-center gap-3 px-4">
        <SageMark size={22} online />
        {expanded && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm font-medium tracking-[0.3em]"
          >
            {APP_NAME}
          </motion.span>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={expanded ? undefined : label}
              className={cn(
                "relative flex h-10 items-center gap-3 px-2.5 text-sm transition-colors",
                active
                  ? "bg-glass-strong text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:bg-[var(--live)] before:content-['']"
                  : "text-muted hover:bg-glass hover:text-foreground",
              )}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
              {expanded && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 px-3 pb-3">
        <Link
          href="/settings"
          title={expanded ? undefined : "Settings"}
          className={cn(
            "flex h-10 items-center gap-3 px-2.5 text-sm transition-colors",
            pathname.startsWith("/settings")
              ? "bg-glass-strong text-foreground"
              : "text-muted hover:bg-glass hover:text-foreground",
          )}
        >
          <Settings className="size-[18px] shrink-0" strokeWidth={1.75} />
          {expanded && <span>Settings</span>}
        </Link>
        <button
          onClick={toggleSidebar}
          title={expanded ? "Collapse" : "Expand"}
          className="flex h-10 items-center gap-3 px-2.5 text-sm text-subtle transition-colors hover:bg-glass hover:text-foreground"
        >
          <PanelLeft className="size-[18px] shrink-0" strokeWidth={1.75} />
          {expanded && <span>Collapse</span>}
        </button>
      </div>
    </motion.aside>
  );
}
