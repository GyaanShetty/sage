"use client";

import { useEffect, useState } from "react";
import { Search, Volume2, VolumeX } from "lucide-react";
import { APP_NAME, fmt } from "@/lib/config";
import { SageMark } from "@/components/ui/sage-mark";
import { sound } from "@/lib/sound";
import { useShellStore } from "@/features/shell/store";

/** Top strip: identity mark, wordmark, live online status, prominent clock. */
export function StatusBar() {
  const [now, setNow] = useState<Date | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen);

  useEffect(() => {
    setNow(new Date());
    setSoundOn(sound.isOn());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-[var(--rule-strong)] bg-background/90 px-4 pt-[var(--sat)] backdrop-blur-xl md:min-h-[54px] md:gap-4 md:px-6">
      <div className="flex items-center gap-3">
        <SageMark size={22} online />
        <span className="brand-title text-[13px] md:text-[15px]">{APP_NAME}</span>
      </div>
      <span className="rail hidden sm:flex">
        <span className="k">MISSION CONTROL</span>
        <span className="v">v0.2</span>
      </span>
      <span className="mx-auto" />
      {/* The palette was keyboard-only, which meant it did not exist at all on
          a phone. This is the same command surface, one tap away. */}
      <button
        onClick={() => setPaletteOpen(true)}
        title="Search and commands"
        aria-label="Search and commands"
        className="flex items-center gap-1.5 border border-[var(--rule)] px-2 py-1 text-subtle transition-colors hover:border-[var(--signal-dim)] hover:text-[var(--signal)]"
      >
        <Search className="size-[14px]" strokeWidth={1.75} />
        <span className="lbl hidden !opacity-70 sm:inline">⌘K</span>
      </button>
      <button
        onClick={() => setSoundOn(sound.toggle())}
        title={soundOn ? "Mute interface sounds" : "Unmute interface sounds"}
        className="text-subtle transition-colors hover:text-foreground"
      >
        {soundOn ? <Volume2 className="size-[15px]" strokeWidth={1.75} /> : <VolumeX className="size-[15px]" strokeWidth={1.75} />}
      </button>
      {/* Amber is reserved for what is genuinely live. This is the one
          persistent piece of system state on every page. */}
      <span className="flex items-center gap-2">
        <span className="sig-dot on" />
        <span className="rail"><span className="sig">SYS ONLINE</span></span>
      </span>
      <div className="text-right">
        <div
          className="num text-[19px] font-light leading-none tracking-tight md:text-[24px]"
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
