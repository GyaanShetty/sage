"use client";

import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/config";

/** Top strip in the COMMAND style: sigil, wordmark, live clock. */
export function StatusBar() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-border-glass bg-background/90 px-6 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <span className="relative block size-[18px] rotate-45 border border-foreground after:absolute after:inset-1 after:bg-foreground after:content-['']" />
        <span className="text-[15px] font-medium tracking-[8px]">{APP_NAME}</span>
      </div>
      <span className="lbl hidden sm:inline">COMMAND · v0.2</span>
      <span className="mx-auto" />
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
        <span className="lbl !text-foreground">ONLINE</span>
      </span>
      <div className="text-right">
        <div className="num text-[22px] font-light leading-none tracking-wide" suppressHydrationWarning>
          {now ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` : "--:--"}
        </div>
        <div className="lbl" suppressHydrationWarning>
          {now ? now.toDateString().toUpperCase() : ""}
        </div>
      </div>
    </header>
  );
}
