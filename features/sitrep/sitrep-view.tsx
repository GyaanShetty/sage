"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Moon, Radio, RefreshCw } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import "./sitrep.css";

/**
 * SITREP — where things stand, live.
 *
 * Every number here is already true on some other page. What did not exist was
 * one reading of all of them at once, refreshing itself, so "where do things
 * stand" stopped meaning "open six pages and do the joining yourself".
 *
 * Two different clocks, deliberately. The countdown to the next commitment
 * ticks every second locally — it needs no server and a countdown that jumps
 * in twenty-second steps looks broken. Everything else refreshes on a slower
 * poll, paused entirely while the tab is hidden, because a status board
 * burning requests in a background tab is how a free tier dies.
 */

type Level = "ok" | "watch" | "alert";

interface Line { key: string; label: string; value: string; detail?: string; level: Level; href?: string }
interface Sitrep { at: string; nextEventAt: string | null; nextEventTitle: string | null; lines: Line[]; alerts: Line[] }
interface NightItem { kind: string; title: string; body: string; href?: string }
interface NightReport { day: string; ranAt: string; greeting: string; items: NightItem[]; quiet: boolean }

const POLL_MS = 20_000;

/** "2h 14m" / "6m 03s" — seconds appear only when they matter. */
function countdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m >= 10) return `${m}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

export function SitrepView({ compact = false }: { compact?: boolean }) {
  const [sitrep, setSitrep] = useState<Sitrep | null>(null);
  const [night, setNight] = useState<NightReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const j = await fetch("/api/sitrep/live").then((r) => r.json()).catch(() => null);
    setRefreshing(false);
    if (j?.ok) { setSitrep(j.data.sitrep); setNight(j.data.night ?? null); }
  }, []);

  // Poll, but only while the tab is actually being looked at. Coming back to
  // a hidden tab refreshes immediately rather than showing a stale board.
  useEffect(() => {
    void load();

    const start = () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => void load(), POLL_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (timer.current) { clearInterval(timer.current); timer.current = null; }
      } else {
        void load();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // The countdown's own clock — local, so it stays smooth between polls.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const untilNext = sitrep?.nextEventAt
    ? new Date(sitrep.nextEventAt).getTime() - Date.now()
    : null;
  // Referenced so the ticking state actually drives a re-render.
  void tick;

  const stale = sitrep ? Date.now() - new Date(sitrep.at).getTime() > POLL_MS * 3 : false;

  return (
    <div className={cn("sr-wrap", compact && "sr-compact")}>
      <div className="sr-head">
        <span className={cn("sr-live", refreshing && "busy", stale && "stale")}>
          <Radio className="size-3" />
          {stale ? "STALE" : refreshing ? "SYNCING" : "LIVE"}
        </span>
        <h3>SITREP</h3>
        <span className="sr-time">
          {sitrep ? new Date(sitrep.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
        </span>
        <button onClick={() => void load()} className="sr-refresh" title="Refresh now">
          {refreshing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
        </button>
      </div>

      {!sitrep && <p className="sr-dim">Reading the board…</p>}

      {sitrep && (
        <>
          {/* The countdown is the one thing worth a whole row. */}
          {sitrep.nextEventTitle && untilNext !== null && (
            <div className={cn("sr-next", untilNext <= 20 * 60_000 && "urgent")}>
              <span className="sr-nextcount">{countdown(untilNext)}</span>
              <span className="sr-nexttitle">{sitrep.nextEventTitle}</span>
            </div>
          )}

          {sitrep.alerts.length > 0 && (
            <div className="sr-alerts">
              {sitrep.alerts.map((a) => (
                <span key={a.key} className="sr-alert">
                  <AlertTriangle className="size-3" /> {a.label}: {a.value}
                  {a.detail && <i>{a.detail}</i>}
                </span>
              ))}
            </div>
          )}

          <div className="sr-grid">
            {sitrep.lines.map((l) => {
              const body = (
                <>
                  <span className="sr-label">{l.label}</span>
                  <span className="sr-value">{l.value}</span>
                  {l.detail && <span className="sr-detail">{l.detail}</span>}
                </>
              );
              return l.href ? (
                <Link key={l.key} href={l.href} className={cn("sr-cell", l.level)}>{body}</Link>
              ) : (
                <div key={l.key} className={cn("sr-cell", l.level)}>{body}</div>
              );
            })}
          </div>

          {/* What SAGE did overnight, shown until the day moves on. */}
          {night && !compact && (
            <div className="sr-night">
              <span className="sr-nighthead"><Moon className="size-3" /> WHILE YOU SLEPT</span>
              <p className="sr-greeting">{night.greeting}</p>
              {night.items.map((item, i) => (
                <div key={i} className="sr-nightitem">
                  <span className={cn("sr-nightkind", item.kind)}>{item.kind}</span>
                  <div className="sr-nightbody">
                    <span className="sr-nighttitle">{item.title}</span>
                    {item.body && <p>{item.body}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
