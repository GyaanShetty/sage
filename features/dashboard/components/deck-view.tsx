"use client";

import Link from "next/link";
import { FileText, Mail, Terminal, NotebookPen, HardDrive, PenLine, CalendarDays, LineChart } from "lucide-react";
import "../command.css";
import "../wall.css";
import "../deck.css";
import { AtlasMap } from "@/features/atlas/atlas-map";
import { TZ } from "@/lib/config";
import { TileGuard } from "@/components/tile-guard";
import { Pane } from "@/components/pane";
import { Crosshair } from "@/components/chrome";
import { AgentLogTile, BioTile, PortfolioTile } from "./page-tiles";
import {
  MarketsTile, KeyMetricsTile, HealthTile, MissionTile, FeedsTile, InboxTile,
} from "./wall-tiles";
import { MachineryTile, ModelLoadTile } from "./ops-tiles";
import { BriefBlock } from "./brief-block";
import { NextAction } from "./next-action";
import { DeckHero } from "./deck-hero";
import type { EventRow, LogRow, Stats, TaskRow, WeatherRow } from "./command-view";

/**
 * The deck — the dashboard as the identity sheet draws it.
 *
 * Three columns around a centre that holds the mark, and a band of four along
 * the bottom. The point of the shape is the middle column: every other pane
 * answers a question you did not ask, and that one waits for you to ask one.
 *
 * The dense thirty-pane wall this replaces is not gone — it moved to /wall and
 * is one click from here. That matters, because he asked for that density
 * explicitly and at length, and a layout that quietly deleted eighteen panes
 * to look better in a screenshot would be answering the wrong request.
 */

const QUICK: { href: string; label: string; Icon: typeof FileText }[] = [
  { href: "/workspace", label: "Docs", Icon: FileText },
  { href: "/mail", label: "Mail", Icon: Mail },
  { href: "/code", label: "Terminal", Icon: Terminal },
  { href: "/knowledge", label: "Notes", Icon: NotebookPen },
  { href: "/portfolio", label: "Assets", Icon: HardDrive },
  { href: "/board", label: "Boards", Icon: PenLine },
  { href: "/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/markets", label: "Markets", Icon: LineChart },
];

export function DeckView({
  tasks, events, log, stats, weather,
}: {
  tasks: TaskRow[];
  events: EventRow[] | null;
  log: LogRow[];
  stats: Stats;
  weather: WeatherRow | null;
}) {
  /*
   * The same few derivations the wall makes. Repeated rather than lifted into
   * a hook: they are five lines, and a shared hook between two layouts that
   * are meant to diverge is the kind of coupling that makes the next change
   * to one of them a change to both.
   */
  const now = new Date();
  const open = tasks.filter((t) => t.status !== "done").length;
  const todays = (events ?? []).filter((e) => new Date(e.start).toDateString() === now.toDateString());
  const agentRunning = log.some((l) => l.type.startsWith("agent."));

  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  const year = Number(dayKey.slice(0, 4));
  const doy = Math.floor((Date.parse(`${dayKey}T00:00:00Z`) - Date.UTC(year, 0, 1)) / 86400000) + 1;

  return (
    <div className="deck">
      <div className="deck-cols">
        {/* ── LEFT ─────────────────────────────────────────────────────── */}
        <div className="deck-col">
          <Pane n={1} title="Atlas Map" status="ONLINE · © OSM" live className="deck-map" frame noZoom>
            <AtlasMap lat={12.9352} lon={77.6245} compact />
            <span className="deck-map-marks" aria-hidden>
              <Crosshair /><Crosshair /><Crosshair /><Crosshair />
            </span>
          </Pane>
          <TileGuard name="FEEDS"><FeedsTile n={3} /></TileGuard>
          <TileGuard name="BIO"><BioTile n={5} /></TileGuard>
          <TileGuard name="MACHINERY"><MachineryTile n={11} /></TileGuard>
        </div>

        {/* ── CENTRE ───────────────────────────────────────────────────── */}
        <div className="deck-col is-centre">
          <DeckHero />
        </div>

        {/* ── RIGHT ────────────────────────────────────────────────────── */}
        <div className="deck-col">
          <TileGuard name="MARKETS"><MarketsTile n={2} /></TileGuard>
          <TileGuard name="MISSION">
            <MissionTile
              n={4}
              open={open}
              events={todays.length}
              agentRunning={agentRunning}
              memories={stats.memories}
              runs={stats.runs}
              weather={weather ? `${Math.round(weather.temp)}°` : null}
            />
          </TileGuard>
          <TileGuard name="AGENTLOG"><AgentLogTile n={6} /></TileGuard>
          <TileGuard name="KEYMETRICS">
            <KeyMetricsTile n={12} week={Math.ceil(doy / 7)} doy={doy}
              quarter={Math.floor(Number(dayKey.slice(5, 7)) / 3.01) + 1}
              open={open} focusMin={0} />
          </TileGuard>
        </div>
      </div>

      {/* ── BOTTOM BAND ────────────────────────────────────────────────── */}
      <div className="deck-band">
        <TileGuard name="DEBRIEF"><div className="wall-cell"><BriefBlock /></div></TileGuard>

        <Pane n={8} title="What Now">
          <NextAction />
        </Pane>

        <TileGuard name="INBOX"><InboxTile n={9} /></TileGuard>
        <TileGuard name="HEALTH"><HealthTile n={10} /></TileGuard>

        <Pane n={13} title="Quick Access" status={<Link href="/wall" className="deck-more">FULL WALL →</Link>}>
          <div className="deck-quick">
            {QUICK.map(({ href, label, Icon }) => (
              <Link key={href} href={href}>
                <Icon className="size-[15px]" strokeWidth={1.5} />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </Pane>

        <TileGuard name="PORTFOLIO"><PortfolioTile n={14} /></TileGuard>
      </div>
    </div>
  );
}
