"use client";

/**
 * The first thing, and the only large type on the page.
 *
 * The old hero was a wireframe wordmark over four counters that read 00 00 00
 * most of the time — a hundred and ninety pixels of screen that told you
 * nothing. This says one sentence, and the sentence is the state of your day.
 *
 * It is assembled rather than generated: no model call, so it is right
 * immediately and costs nothing. A greeting that takes two seconds to arrive
 * is worse than no greeting.
 */

import { useEffect, useState } from "react";
import { shareJson } from "@/lib/share";
import { TZ } from "@/lib/config";

interface Desk { openTasks: number; events: number; memories: number }
interface Weather { temp: number; label: string }

function partOfDay(): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

export function Lead() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [wx, setWx] = useState<Weather | null>(null);

  useEffect(() => {
    shareJson<{ data?: Desk }>("/api/desk").then((j) => setDesk(j?.data ?? null)).catch(() => {});
    shareJson<{ data?: Weather }>("/api/weather").then((j) => setWx(j?.data ?? null)).catch(() => {});
  }, []);

  /*
   * Say the number of things, or say there are none. Both are useful; a
   * missing line is not, which is why this never renders empty — it falls back
   * to the greeting alone rather than waiting for a count that may never come.
   */
  const bits: string[] = [];
  if (desk) {
    if (desk.openTasks > 0) bits.push(`${desk.openTasks} open`);
    if (desk.events > 0) bits.push(`${desk.events} on the calendar`);
  }
  const line = bits.length
    ? bits.join(" · ")
    : desk
      ? "Nothing open, nothing scheduled."
      : "";

  return (
    <div style={{ marginBottom: "var(--s6)" }}>
      <h1 className="lead">{partOfDay()}.</h1>
      <p className="lead-sub">
        {line}
        {wx && <>{line ? " · " : ""}<span className="num">{Math.round(wx.temp)}°</span> {wx.label.toLowerCase()}</>}
      </p>
    </div>
  );
}
