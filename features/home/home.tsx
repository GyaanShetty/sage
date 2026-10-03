"use client";

/**
 * The whole application, on one page.
 *
 * Twenty-seven pages and thirty panels became this: a greeting, what today is
 * made of, where money stands, what there is to read, and a field to ask
 * anything. Scrolled, not tiled — so it works at any height, including the
 * phone height the fixed wall used to clip.
 *
 * Everything else still exists and is still reachable through ⌘K. It is simply
 * not on show, which was the whole problem with the last one.
 */

import { useEffect, useState } from "react";
import { APP_NAME, TZ } from "@/lib/config";
import { Lead } from "./lead";
import { Today } from "./today";
import { Money } from "./money";
import { Read } from "./read";
import { Ask } from "./ask";

function Clock() {
  const [t, setT] = useState<string>("");
  useEffect(() => {
    const tick = () => setT(new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date()));
    tick();
    const id = setInterval(tick, 30_000);   // minutes, so once every half minute is plenty
    return () => clearInterval(id);
  }, []);
  return <span className="top-when num">{t}</span>;
}

export function Home() {
  return (
    <div className="page">
      <header className="top">
        <span className="mark top-mark">{APP_NAME}</span>
        <Clock />
      </header>

      <Lead />
      <Ask />

      <div style={{ height: "var(--s7)" }} />

      <Today />
      <Money />
      <Read />

      <footer className="foot">
        <span>Press <kbd>⌘K</kbd> for everything else</span>
      </footer>
    </div>
  );
}
