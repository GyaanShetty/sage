"use client";

/**
 * The time, large enough to read from across the room.
 *
 * There was already a clock in the top strip at 8px, which is a clock you
 * have to go and find. This is the one you see. It carries the three
 * things a date answers — which day of the week it is, the date, and the
 * time — and nothing else, because a clock that also tells you the
 * weather is a widget.
 *
 * Seconds are shown but held back a step in weight. They change every
 * second and so would otherwise be the most visually active thing on a
 * screen full of real news.
 */

import { useEffect, useState } from "react";
import { TZ } from "@/lib/config";

const part = (opts: Intl.DateTimeFormatOptions) => (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts }).format(d);

const hm = part({ hour: "2-digit", minute: "2-digit", hour12: false });
const ss = part({ second: "2-digit" });
const dayName = part({ weekday: "long" });
const dateStr = part({ day: "2-digit", month: "long", year: "numeric" });

export function ClockTile() {
  /*
   * Empty until mounted.
   *
   * A clock rendered on the server is wrong by however long the page took
   * to arrive, and React will shout about the hydration mismatch besides.
   * The em-dashes hold the exact layout the real values will take, so
   * nothing jumps when the first tick lands.
   */
  const [t, setT] = useState<{ hm: string; ss: string; day: string; date: string } | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setT({ hm: hm(d), ss: ss(d), day: dayName(d), date: dateStr(d) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="ck" aria-label="Current date and time">
      <div className="ck-time">
        <span className="ck-hm num">{t?.hm ?? "--:--"}</span>
        <span className="ck-ss num">{t?.ss ?? "--"}</span>
      </div>
      <div className="ck-date">
        <span className="ck-day">{t?.day ?? "—"}</span>
        <span className="ck-d">{t?.date ?? "—"}</span>
      </div>
    </div>
  );
}
