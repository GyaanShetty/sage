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

import { useEffect, useState } from "react";
import { APP_NAME, APP_MOTTO, TZ } from "@/lib/config";
import { HeroCanvas } from "./hero-canvas";
import type { EventRow } from "./command-view";
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

/** "Sunday, 4 October 2026" — the line a front page carries under its name. */
function useEdition(): string {
  const [d, setD] = useState("");
  useEffect(() => {
    const fmt = () => new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric",
    }).format(new Date());
    setD(fmt());
    const id = setInterval(() => setD(fmt()), 60_000);
    return () => clearInterval(id);
  }, []);
  return d;
}

export function DashHero({
  open,
  events,
  eventRows,
  overdue,
  agentRunning,
  weather,
}: {
  open: number;
  events: number;
  /** The rows themselves, for the canvas; `events` stays the count. */
  eventRows: EventRow[] | null;
  overdue: number;
  agentRunning: boolean;
  weather: string | null;
}) {
  const edition = useEdition();

  return (
    <section className="dash-hero">
      {/* The day, drawn. This replaced a dot-globe that was decoration: it
          marked Bengaluru and otherwise said nothing that changed. The
          canvas says what hour it is, what is open, and what is coming. */}
      <HeroCanvas events={eventRows} />

      <HeroTime />

      <div className="dh-centre">
        {/*
          * A masthead, not a boot screen.
          *
          * This was block-glyph art spelling SAGE with "MISSION CONTROL ·
          * STANDING BY" under it and a scanning bar beside that. The art was
          * never a typeface — it was characters arranged to look like one, and
          * it was the single most science-fiction thing on the page.
          *
          * The name is set in the wordmark face, which he has asked twice to
          * keep, between two rules the way a paper sets its nameplate. The
          * line under it is a dateline: what this edition is and when, which
          * is what sits there on a front page and is also more use than
          * "STANDING BY".
          */}
        <div className="dh-mark">
          <span className="dh-rules">
            <span className="dh-nameplate">{APP_NAME}</span>
          </span>
          <span className="dh-tag">
            {edition} · {agentRunning ? "Agent running" : APP_MOTTO}
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
