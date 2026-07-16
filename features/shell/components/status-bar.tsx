"use client";

import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/config";

/** Top HUD strip: system identity, live clock, status. */
export function StatusBar() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex h-9 shrink-0 items-center gap-4 border-b border-border-glass bg-black/40 px-4 backdrop-blur-xl">
      <span className="hud-label !text-foreground">{APP_NAME} OS</span>
      <span className="hud-label hidden sm:inline">v0.1 · PERSONAL</span>
      <span className="mx-auto" />
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 animate-pulse rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />
        <span className="hud-label !text-accent">ONLINE</span>
      </span>
      <span className="hud-label tabular-nums" suppressHydrationWarning>
        {now
          ? now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase() +
            " · " +
            now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
          : ""}
      </span>
    </header>
  );
}
