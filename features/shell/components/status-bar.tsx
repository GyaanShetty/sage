"use client";

import { useEffect, useState } from "react";
import { APP_NAME, fmt } from "@/lib/config";
import { SageMark } from "@/components/ui/sage-mark";

/** Top strip: identity mark, wordmark, live online status, prominent clock. */
export function StatusBar() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-4 border-b border-border-glass bg-background/85 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <SageMark size={22} online />
        <span className="text-[15px] font-medium tracking-[0.42em]">{APP_NAME}</span>
      </div>
      <span className="lbl hidden sm:inline">MISSION CONTROL · v0.2</span>
      <span className="mx-auto" />
      <span className="flex items-center gap-2">
        <span className="live-dot size-1.5 animate-pulse rounded-full" />
        <span className="lbl live !opacity-90">ONLINE</span>
      </span>
      <div className="text-right">
        <div
          className="num text-[24px] font-light leading-none tracking-tight"
          suppressHydrationWarning
        >
          {now ? fmt(now, { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--"}
        </div>
        <div className="lbl mt-0.5" suppressHydrationWarning>
          {now ? fmt(now, { weekday: "short", day: "2-digit", month: "short" }).toUpperCase() + " IST" : ""}
        </div>
      </div>
    </header>
  );
}
