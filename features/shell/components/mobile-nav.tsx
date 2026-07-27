"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, MessageSquare, CandlestickChart, ListTodo, Orbit } from "lucide-react";
import { cn } from "@/lib/utils";

// Four primary tabs pinned to the bottom bar; everything else lives in the wheel.
const TABS = [
  { href: "/dashboard", label: "HOME", icon: LayoutDashboard },
  { href: "/chat", label: "CHAT", icon: MessageSquare },
  { href: "/markets", label: "MARKETS", icon: CandlestickChart },
  { href: "/workspace", label: "TASKS", icon: ListTodo },
];

/** Bottom tab bar — phones only. The WHEEL button opens the rotary launcher
 *  (RadialNav) for every other page. */
export function MobileNav() {
  const pathname = usePathname();
  const primary = TABS.some((t) => pathname.startsWith(t.href));

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
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("sage:open-wheel"))}
        className={cn(
          "relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors",
          !primary ? "text-foreground" : "text-subtle",
        )}
      >
        {!primary && <span className="absolute inset-x-6 top-0 h-0.5 bg-[var(--live)]" />}
        <Orbit className="size-[18px]" strokeWidth={1.6} />
        <span className="lbl !text-[8px] !tracking-[1.5px]" style={{ color: "inherit" }}>WHEEL</span>
      </button>
    </nav>
  );
}
