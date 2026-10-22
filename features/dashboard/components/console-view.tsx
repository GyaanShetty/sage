"use client";

/**
 * The console.
 *
 * Built to the drone-tracker reference: one screen, a dominant stage, two
 * dense rails and a timeline across the bottom. What that reference gets
 * right is not its palette — SAGE already had a palette — but its
 * composition. The wall had twenty-four panes of equal weight over four and
 * a half screens, which is the definition of having no view at all.
 *
 * Everything shown here already existed. Nothing new was built to fill it;
 * the pieces were only given a hierarchy:
 *
 *   · the STAGE is the map, because it is the one thing read by looking
 *     rather than by reading, and a console needs a place for the eye to
 *     start;
 *   · the LEFT RAIL is control — what is standing, what is due, what is
 *     next — which is what you check before you do anything;
 *   · the RIGHT RAIL is intelligence — what SAGE wants, the markets, what
 *     the wire is chasing — which is what you check while you work;
 *   · the FOOT is the day, which SAGE was already drawing on a canvas and
 *     which is exactly the reference's mission-playback strip.
 *
 * The wall is not deleted. It is one tab away, because twenty-four panes is
 * the right view for a Sunday afternoon and the wrong one for a Tuesday.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pane } from "@/components/pane";
import { TileGuard } from "@/components/tile-guard";
import { AtlasMap } from "@/features/atlas/atlas-map";
import { HeroCanvas } from "./hero-canvas";
import { Docket } from "./docket";
import { DirectivesPanel } from "./routine-tiles";
import { AgendaPanel } from "./agenda-panel";
import { GmailPanel } from "./gmail-panel";
import { MarketsList } from "./markets-list";
import { HotTopics } from "./hot-topics";
import { MorningWire } from "./morning-wire";
import { SitrepBand } from "./sitrep-band";
import { TZ, APP_NAME } from "@/lib/config";
import type { EventRow, TaskRow } from "./command-view";
import "../console.css";

const clock = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d);

export function ConsoleView({
  tasks: initialTasks,
  events,
  weather,
  onWall,
}: {
  tasks: TaskRow[];
  events: EventRow[] | null;
  weather: string | null;
  onWall: () => void;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [now, setNow] = useState<string>("");

  /* Rendered client-side only. A clock in the server's markup is a clock
     that is wrong by however long the page took to arrive, and React will
     shout about the mismatch besides. */
  useEffect(() => {
    const tick = () => setNow(clock(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const open = tasks.filter((t) => t.status !== "done").length;
  const overdue = tasks.filter(
    (t) => t.status !== "done" && t.dueAt && Date.parse(t.dueAt) < Date.now(),
  ).length;
  const today = (events ?? []).filter(
    (e) => new Date(e.start).toDateString() === new Date().toDateString(),
  );
  const next = today
    .map((e) => ({ e, t: new Date(e.start).getTime() }))
    .filter((x) => x.t >= Date.now())
    .sort((a, b) => a.t - b.t)[0]?.e;

  return (
    <div className="console">
      <div className="cs-strip">
        <span className="cs-id">
          <b>{APP_NAME}</b> · operations
        </span>
        <span className="cs-right">BENGALURU STATION</span>
        <span className="cs-right num">{now}</span>

        <nav className="cs-nav" aria-label="Views">
          <button className="cs-tab on">Console</button>
          <button className="cs-tab" onClick={onWall}>Wall</button>
          <Link className="cs-tab" href="/markets">Markets</Link>
          <Link className="cs-tab" href="/study">Study</Link>
          <Link className="cs-tab" href="/workspace">Board</Link>
          <Link className="cs-tab" href="/gods-eye">God&rsquo;s Eye</Link>
        </nav>

        <span className="cs-right">
          {overdue > 0 ? <>THREAT <b>{overdue} LATE</b></> : <>STATUS <b>NOMINAL</b></>}
        </span>
      </div>

      {/* ── control ─────────────────────────────────────────────────── */}
      <div className="cs-left">
        <TileGuard name="SITREP"><div className="wall-cell"><SitrepBand compact /></div></TileGuard>
        <TileGuard name="DIRECTIVES">
          <DirectivesPanel n={1} tasks={tasks} setTasks={setTasks} />
        </TileGuard>
        <TileGuard name="AGENDA"><AgendaPanel n={2} events={events} /></TileGuard>
        <TileGuard name="INBOX"><GmailPanel n={3} /></TileGuard>
      </div>

      {/* ── the stage ───────────────────────────────────────────────── */}
      <div className="cs-stage">
        <TileGuard name="STAGE">
          <Pane title="Atlas" bare noZoom className="wall-map">
            <AtlasMap lat={12.9352} lon={77.6245} compact />
          </Pane>
        </TileGuard>
        {/*
          The readouts sit in the corners so the middle of the map stays the
          map. Everything here is already on the page elsewhere — this is the
          glance version, for when you are looking at the stage anyway.
        */}
        <div className="cs-hud" aria-hidden>
          <div className="cs-hud-tl">
            <b>12.9352°N 77.6245°E</b>
            <span>Bengaluru · {weather ?? "—"}</span>
          </div>
          <div className="cs-hud-tr">
            <b>{open.toString().padStart(2, "0")} OPEN</b>
            <span className={overdue ? "lit" : undefined}>
              {overdue ? `${overdue} overdue` : "nothing late"}
            </span>
          </div>
          <div className="cs-hud-bl">
            <b>{today.length.toString().padStart(2, "0")} TODAY</b>
            <span>{next ? `next · ${next.summary}` : "calendar clear"}</span>
          </div>
          <div className="cs-hud-br">
            <b className="lit">LIVE</b>
            <span>© OpenStreetMap</span>
          </div>
        </div>
      </div>

      {/* ── intelligence ────────────────────────────────────────────── */}
      <div className="cs-right-rail">
        <TileGuard name="DOCKET"><Docket n={0} /></TileGuard>
        <TileGuard name="MARKETS"><MarketsList n={4} limit={8} /></TileGuard>
        <TileGuard name="HOTTOPICS"><HotTopics n={5} /></TileGuard>
        <TileGuard name="MORNINGWIRE"><MorningWire n={6} /></TileGuard>
      </div>

      {/* ── the day ─────────────────────────────────────────────────── */}
      <div className="cs-foot">
        <div className="cs-foot-hd">
          <b>Today</b>
          <span>24h · sessions · calendar</span>
          <span className="lit">{now}</span>
        </div>
        <div className="cs-foot-body">
          <TileGuard bare name="TIMELINE"><HeroCanvas events={events} /></TileGuard>
        </div>
      </div>
    </div>
  );
}
