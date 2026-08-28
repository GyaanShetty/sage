"use client";

import { useState } from "react";
import { TZ } from "@/lib/config";
import { useLive } from "@/lib/live";

/**
 * The figures along the top of the terminal.
 *
 * Boxed cells, each a large tabular number over a small caps key. It is the
 * densest possible answer to "how does today stand" — six numbers and a clock,
 * readable without reading.
 *
 * Every field is a count of something real. The uplink figure is the time the
 * aggregate request actually took, not an invented latency: a screen full of
 * measurements only works if all of them are measurements.
 */

interface Desk {
  openTasks: number; events: number; committedMin: number;
  agentRuns: number; alerts: number; uplinkMs: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 585 → "9H45". Hours and minutes, because "9.75h" is not how a day feels. */
function commitment(min: number): string {
  if (!min) return "—";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}H${pad(m)}` : `${m}M`;
}

export function DeskStrip() {
  const [d, setDesk] = useState<Desk | null>(null);
  const [clock, setClock] = useState("");

  useLive(
    () => fetch("/api/desk").then((r) => r.json()).then((j) => setDesk(j?.data ?? null)).catch(() => {}),
    { everyMs: 60_000, hiddenMs: 300_000, scopes: ["tasks", "events", "notes"] },
  );

  useLive(
    () => {
      setClock(new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).format(new Date()));
    },
    { everyMs: 1000, hiddenMs: 60_000 },
  );

  const cell = (v: string, k: string, tone?: "signal" | "up" | "down") => (
    <div className="desk-cell" key={k}>
      <span className={`desk-v${tone ? ` ${tone}` : ""}`}>{v}</span>
      <span className="desk-k">{k}</span>
    </div>
  );

  return (
    <div className="desk-strip">
      {cell(d ? pad(d.openTasks) : "··", "OPEN TASKS", d && d.openTasks ? "signal" : undefined)}
      {cell(d ? pad(d.events) : "··", "EVENTS")}
      {cell(d ? commitment(d.committedMin) : "··", "COMMITTED")}
      {cell(d ? pad(d.agentRuns) : "··", "AGENT RUNS")}
      {cell(d ? pad(d.alerts) : "··", "ALERTS", d && d.alerts ? "down" : undefined)}
      {cell(d ? `${d.uplinkMs}MS` : "··", "UPLINK", d && d.uplinkMs < 800 ? "up" : "down")}
      <div className="desk-cell wide">
        <span className="desk-v clock">{clock || "--:--:--"}</span>
        <span className="desk-k">IST · KOLKATA</span>
      </div>
    </div>
  );
}
