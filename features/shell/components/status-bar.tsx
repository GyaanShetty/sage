"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { APP_NAME, fmt } from "@/lib/config";
import { SageMark } from "@/components/ui/sage-mark";
import { sound } from "@/lib/sound";

/** Top strip: identity mark, wordmark, live online status, prominent clock. */
export function StatusBar() {
  const [now, setNow] = useState<Date | null>(null);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    setNow(new Date());
    setSoundOn(sound.isOn());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border-glass bg-background/85 px-4 backdrop-blur-xl md:h-[54px] md:gap-4 md:px-6">
      <div className="flex items-center gap-3">
        <SageMark size={22} online />
        <span className="text-[13px] font-medium tracking-[0.42em] md:text-[15px]">{APP_NAME}</span>
      </div>
      <span className="lbl hidden sm:inline">MISSION CONTROL · v0.2</span>
      <span className="mx-auto" />
      <button
        onClick={() => setSoundOn(sound.toggle())}
        title={soundOn ? "Mute interface sounds" : "Unmute interface sounds"}
        className="text-subtle transition-colors hover:text-foreground"
      >
        {soundOn ? <Volume2 className="size-[15px]" strokeWidth={1.75} /> : <VolumeX className="size-[15px]" strokeWidth={1.75} />}
      </button>
      <span className="flex items-center gap-2">
        <span className="live-dot size-1.5 animate-pulse rounded-full" />
        <span className="lbl live !opacity-90">ONLINE</span>
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
