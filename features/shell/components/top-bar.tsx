"use client";

/**
 * The masthead.
 *
 * Wordmark and motto on the left, the one input that does everything in the
 * middle, and the standing state on the right: the clock, the four verbs, and
 * where you are with what it is doing outside.
 *
 * The search field is a button, not an input. It opens the command palette,
 * which already handles pages, actions and asking SAGE — two search boxes
 * that behave differently is how you end up typing into the wrong one.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { APP_MOTTO, APP_NAME, TZ } from "@/lib/config";
import { useFeed } from "@/lib/feed";
import { sound } from "@/lib/sound";
import { useShellStore } from "@/features/shell/store";

const VERBS = ["OBSERVE", "ANALYZE", "UNDERSTAND", "EXECUTE"];

type Weather = { temp: number; place?: string } | null;

function Clock() {
  // Rendered in an effect: a server-rendered clock is wrong by the time it
  // paints, and rendering one during the first client pass makes React
  // complain the markup disagrees.
  const [now, setNow] = useState<{ d: string; t: string } | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow({
        d: new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short", year: "numeric" })
          .format(d).toUpperCase().replace(/,/g, ""),
        t: new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="tb-clock">
      <span className="tb-date">{now?.d ?? "—"}</span>
      <span className="tb-time">{now?.t ?? "--:--:--"}</span>
      <span className="tb-tz">IST</span>
    </div>
  );
}

export function TopBar() {
  const openPalette = useShellStore((s) => s.setPaletteOpen);
  const weather = useFeed<Weather>("/api/weather", { everyMs: 15 * 60_000 });
  const temp = weather.data?.temp;

  return (
    <header className="topbar">
      <Link href="/dashboard" className="tb-brand">
        <span className="tb-name">{APP_NAME}</span>
        <span className="tb-motto">{APP_MOTTO.toUpperCase()}</span>
      </Link>

      <button
        className="tb-search"
        onClick={() => { sound.tick(); openPalette(true); }}
      >
        <Search className="size-4" strokeWidth={1.5} aria-hidden />
        <span className="tb-search-t">Search markets, ask {APP_NAME}, or run a command…</span>
        <kbd>⌘ K</kbd>
      </button>

      <Clock />

      <ul className="tb-verbs" aria-label="What SAGE does">
        {VERBS.map((v) => <li key={v}>{v}</li>)}
      </ul>

      <div className="tb-place">
        <span className="tb-moon" aria-hidden />
        <span className="tb-place-t">
          <b>BENGALURU</b>
          <span>INDIA</span>
          <span className="tb-temp">{temp !== undefined ? `${Math.round(temp)}° C` : "—"}</span>
        </span>
      </div>
    </header>
  );
}
