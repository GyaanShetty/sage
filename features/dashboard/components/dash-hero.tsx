"use client";

/**
 * The wall's hero band.
 *
 * The overview opened straight into seventeen readouts, which is why it read
 * as dense before you had read a single number: there was no place for the
 * eye to land first. This is that place — the name, a line of standing state,
 * and ambient motion behind it — and it earns its height by taking tiles off
 * the wall rather than being added on top of them.
 *
 * The wordmark assembles once and then holds. The motion behind it is the
 * rain, which is texture and never resolves into anything you are meant to
 * read. A banner that keeps re-scrambling its own name is a screensaver.
 *
 * No clock here. The frame above already carries the time twice, and a third
 * copy in the one band meant to be uncluttered is exactly the density this
 * was built to relieve. The readings it does carry are the ones you would
 * otherwise have to find in a tile: what is open, what is today, what is
 * late.
 */

import { APP_NAME } from "@/lib/config";
import { AsciiMark } from "@/components/ascii/mark";
import { AsciiRain, AsciiScan } from "@/components/ascii/motifs";
import { Globe } from "@/components/globe";
import { HeroTime, HeroMachine } from "./hero-flanks";

function Stat({
  v,
  k,
  tone,
}: {
  v: string;
  k: string;
  tone?: "signal" | "ok";
}) {
  return (
    <div className="dh-stat">
      <b className={tone ? `is-${tone}` : undefined}>{v}</b>
      <span>{k}</span>
    </div>
  );
}

export function DashHero({
  open,
  events,
  overdue,
  agentRunning,
  weather,
}: {
  open: number;
  events: number;
  overdue: number;
  agentRunning: boolean;
  weather: string | null;
}) {
  return (
    <section className="dash-hero">
      <div className="dh-rain" aria-hidden>
        <AsciiRain cols={120} rows={9} density={0.16} />
      </div>
      <div className="dh-sweep" aria-hidden />
      {/* Behind the mark, not beside it: the globe is the ground the name
          stands on. Real lat/lon geometry with Bengaluru marked, so the
          bright point is where you actually are. */}
      <Globe className="dh-globe" />

      <HeroTime />

      <div className="dh-centre">
        <div className="dh-mark">
          <AsciiMark label={APP_NAME} />
          <span className="dh-tag">
            <AsciiScan width={18} /> MISSION CONTROL ·{" "}
            {agentRunning ? "AGENT RUNNING" : "STANDING BY"}
          </span>
        </div>

        <div className="dh-stats">
          <Stat
            v={String(open).padStart(2, "0")}
            k="OPEN"
            tone={open > 0 ? "signal" : undefined}
          />
          <Stat v={String(events).padStart(2, "0")} k="TODAY" />
          <Stat
            v={String(overdue).padStart(2, "0")}
            k="OVERDUE"
            tone={overdue > 0 ? "signal" : undefined}
          />
          <Stat v={weather ?? "—"} k="OUTSIDE" />
        </div>
      </div>

      <HeroMachine />
    </section>
  );
}
