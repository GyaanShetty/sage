"use client";

/**
 * The console.
 *
 * Rebuilt to the Gotham reference — the Batman v Superman surveillance
 * console, which is the clearest statement of this genre anyone has made.
 * Worth being precise about what was taken from it, because it is not the
 * palette and it is not the ornament:
 *
 *   · A BEZEL. The reference is framed on every edge: an identifier strip
 *     down the left, a status strip across the top, a command bar across
 *     the bottom. Nothing floats. That frame is most of why it reads as
 *     equipment rather than as a page, and SAGE had none of it.
 *   · ONE FRAME PER GROUP. Its left panel is a single bordered module
 *     divided by labelled rules. SAGE had eight separate bordered cards
 *     with gaps between them — eight times the chrome for the same
 *     content, which is the whole reason it felt cluttered.
 *   · THE PICTURE IS THE SUBJECT. Corner brackets, a tick ruler, four
 *     corner readouts, and a status line underneath naming the place, the
 *     state and the feed id. Everything else on the screen is quieter
 *     than it.
 *   · IDENTIFIERS EVERYWHERE. `gth-02X.map`, `x5-0039`, `WAYNE IND.05.2016`.
 *     A console that can tell you which build and which feed it is running
 *     is one you can trust. SAGE knew all of it and never said any of it.
 *
 * What is NOT taken: the crammed density. The reference is mostly black.
 * Its authority comes from a few dense things against a lot of nothing,
 * and the instinct to fill the remaining space is the one to resist.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { TileGuard } from "@/components/tile-guard";
import { LiveTv } from "./live-tv";
import { PictureWall } from "./picture-wall";
import { BoardTile } from "./board-tile";
import { HeroCanvas } from "./hero-canvas";
import { Docket } from "./docket";
import { DirectivesPanel } from "./routine-tiles";
import { AgendaPanel } from "./agenda-panel";
import { GmailPanel } from "./gmail-panel";
import { MarketsList } from "./markets-list";
import { HotTopics } from "./hot-topics";
import { MorningWire } from "./morning-wire";
import { SitrepBand } from "./sitrep-band";
import { TaskBoard } from "./task-board";
import { ProgressPanel } from "./progress-panel";
import { TrainingTile } from "./training-tile";
import { MiniCalendar } from "./mini-calendar";
import { BriefTile } from "./brief-tile";
import { ClockTile } from "./clock-tile";
import { TZ, APP_NAME } from "@/lib/config";
import type { EventRow, TaskRow } from "./command-view";
import "../console.css";

const clock = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d);

const DATE = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, day: "2-digit", month: "short", year: "numeric",
  }).format(d).toUpperCase().replace(/ /g, ".");

type Stage = "live" | "tasks" | "wire" | "board";

/*
 * What each stage is, in the reference's own three-part grammar: a place,
 * a state, and a feed identifier. The identifiers are real — they name the
 * component actually mounted — because an id that is decoration is worse
 * than no id.
 */
const STAGES: { id: Stage; label: string; state: string; feed: string }[] = [
  { id: "live",  label: "Screens", state: "ON AIR", feed: "tv-03.live" },
  { id: "tasks", label: "Board",   state: "BOARD",  feed: "tt-01.task" },
  { id: "wire",  label: "Wire",    state: "WIRE",   feed: "wire-01.img" },
  { id: "board", label: "Canvas",  state: "CANVAS", feed: "bd-00.draw" },
];

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
  const [today_, setToday_] = useState<string>("");

  /*
   * Which of the three the stage is showing, remembered.
   *
   * A switcher rather than my choosing for him again: the stage is half
   * the screen, and what deserves that is different at 7am and 7pm.
   */
  const [stage, setStage] = useState<Stage>("live");
  useEffect(() => {
    try {
      const v = localStorage.getItem("sage-stage");
      if (v === "wire" || v === "board" || v === "live" || v === "tasks") setStage(v);
    } catch { /* blocked storage — the default stands */ }
  }, []);
  const pickStage = (v: Stage) => {
    setStage(v);
    try { localStorage.setItem("sage-stage", v); } catch { /* not worth failing over */ }
  };

  /* Rendered client-side only. A clock in the server's markup is a clock
     that is wrong by however long the page took to arrive, and React will
     shout about the mismatch besides. */
  useEffect(() => {
    const tick = () => { const d = new Date(); setNow(clock(d)); setToday_(DATE(d)); };
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

  const nowStage = STAGES.find((s) => s.id === stage) ?? STAGES[0];
  const pad2 = (n: number) => n.toString().padStart(2, "0");

  return (
    <div className="console">

      {/* ── the top strip ───────────────────────────────────────────── */}
      <header className="cns-top">
        <span className="cns-mark"><b>{APP_NAME}</b> operations</span>
        <span>Bengaluru station</span>
        <span className="num">{now || "--:--:--"}</span>
        <span>IST</span>

        <nav className="cns-grp" aria-label="Stage">
          {STAGES.map((s) => (
            <button
              key={s.id}
              data-stage={s.id}
              aria-pressed={stage === s.id}
              className={`cns-mi${stage === s.id ? " on" : ""}`}
              onClick={() => pickStage(s.id)}
            >{s.label}</button>
          ))}
        </nav>

        <span className="cns-sp" />

        <nav className="cns-grp" aria-label="Views">
          <button className="cns-mi on">Console</button>
          <button className="cns-mi" onClick={onWall}>Wall</button>
          <Link className="cns-mi" href="/markets">Markets</Link>
          <Link className="cns-mi" href="/study">Study</Link>
          <Link className="cns-mi" href="/workspace">Board</Link>
          <Link className="cns-mi" href="/gods-eye">God&rsquo;s Eye</Link>
        </nav>

        <span>
          {overdue > 0
            ? <>threat <b className="num">{pad2(overdue)} late</b></>
            : <>status <b className="num">nominal</b></>}
        </span>
      </header>

      {/* ── the bezel ───────────────────────────────────────────────── */}
      <aside className="cns-vert" aria-hidden>
        <span className="cns-vert-t">
          {APP_NAME} · console · {today_ || "——"}
        </span>
      </aside>

      {/* ── control: what is standing, what is due, what is next ────── */}
      <section className="cns-fr cns-left" aria-label="Control">
        <div className="cns-rail">
          {/* The clock sits above everything because it is the only thing
              here you read without being asked to. */}
          <ClockTile />
          <TileGuard name="SITREP"><div className="wall-cell"><SitrepBand compact /></div></TileGuard>
          <TileGuard name="AGENDA"><AgendaPanel n={1} events={events} /></TileGuard>
          <TileGuard name="CALENDAR"><MiniCalendar n={2} events={events} /></TileGuard>
          <TileGuard name="TRAINING"><TrainingTile n={3} events={events} /></TileGuard>
          <TileGuard name="DIRECTIVES">
            <DirectivesPanel n={4} tasks={tasks} setTasks={setTasks} />
          </TileGuard>
          <TileGuard name="INBOX"><GmailPanel n={5} /></TileGuard>
        </div>
      </section>

      {/* ── the stage ───────────────────────────────────────────────── */}
      <section className="cns-stage" data-stage={stage} aria-label="Stage">
        <div className="cns-stage-media">
          <TileGuard name="STAGE">
            {stage === "live" && <LiveTv n={9} />}
            {stage === "tasks" && <TaskBoard n={9} />}
            {stage === "wire" && <PictureWall n={9} />}
            {stage === "board" && <BoardTile n={9} />}
          </TileGuard>

          {/*
            Four corner readouts. Everything here is on the page elsewhere —
            this is the glance version, for when you are looking at the
            stage anyway. They sit inside the media box rather than over the
            whole stage, which is what keeps them off the caption strip.
          */}
          <div className="cns-hud" aria-hidden>
            <div className="cns-hud-tl">
              <b>Bengaluru · {weather ?? "—"}</b>
              <span>{pad2(today.length)} on the calendar</span>
            </div>
            <div className="cns-hud-tr">
              <b>{pad2(open)} open</b>
              <span className={overdue ? "lit" : undefined}>
                {overdue ? `${pad2(overdue)} overdue` : "nothing late"}
              </span>
            </div>
            <div className="cns-hud-bl">
              <b>{pad2(today.length)} today</b>
              <span>{next ? `next · ${next.summary}` : "calendar clear"}</span>
            </div>
            <div className="cns-hud-br">
              <b>{now || "--:--:--"}</b>
              <span>local</span>
            </div>
          </div>
        </div>

        {/* Place, state, feed — the reference's own bottom line. */}
        <div className="cns-stage-bar">
          <span>Bengaluru</span>
          <span><i className="cns-pip" /> <b>{nowStage.state}</b></span>
          <span>{nowStage.feed}</span>
          <span className="num"><b>{now || "--:--:--"}</b></span>
        </div>
      </section>

      {/* ── intelligence: what SAGE wants, what moved, what is chased ── */}
      <section className="cns-fr cns-right" aria-label="Intelligence">
        <div className="cns-rail">
          <TileGuard name="BRIEF"><BriefTile n={6} /></TileGuard>
          <TileGuard name="DOCKET"><Docket n={7} /></TileGuard>
          <TileGuard name="PROGRESS"><ProgressPanel n={8} /></TileGuard>
          <TileGuard name="MARKETS"><MarketsList n={9} limit={8} /></TileGuard>
          <TileGuard name="HOTTOPICS"><HotTopics n={10} /></TileGuard>
          <TileGuard name="MORNINGWIRE"><MorningWire n={11} /></TileGuard>
        </div>
      </section>

      {/* ── the day ─────────────────────────────────────────────────── */}
      <section className="cns-foot" aria-label="Today">
        <div className="cns-foot-hd">
          <span><b>Today</b></span>
          <span>24h · sessions · calendar</span>
          <span>{today_ || "——"}</span>
          <span><b>{now || "--:--:--"}</b></span>
        </div>
        <div className="cns-foot-body">
          <TileGuard bare name="TIMELINE"><HeroCanvas events={events} /></TileGuard>
        </div>
      </section>

      {/* ── the command bar ─────────────────────────────────────────── */}
      <footer className="cns-bar">
        <span><b>{APP_NAME}</b> os</span>
        <span>console.view</span>
        <span>stage · <b>{nowStage.feed}</b></span>
        <span>tz · kolkata</span>
        <span className="cns-bar-sp" />
        <span>open <b className="num">{pad2(open)}</b></span>
        <span>today <b className="num">{pad2(today.length)}</b></span>
        <span>late <b className="num">{pad2(overdue)}</b></span>
        <span><i className="cns-pip" /> live</span>
      </footer>
    </div>
  );
}
