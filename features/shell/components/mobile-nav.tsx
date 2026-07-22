"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, MessageSquare, CandlestickChart, ListTodo, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard", label: "HOME", icon: LayoutDashboard },
  { href: "/chat", label: "CHAT", icon: MessageSquare },
  { href: "/markets", label: "MARKETS", icon: CandlestickChart },
  { href: "/workspace", label: "TASKS", icon: ListTodo },
  { href: "/settings", label: "CONFIG", icon: Settings },
];

/** Bottom tab bar — phones only; the side rail takes over from md up. */
export function MobileNav() {
  const pathname = usePathname();
  return (
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
    </nav>
  );
}
