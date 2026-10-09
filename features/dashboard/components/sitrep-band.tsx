"use client";

import { useEffect, useState } from "react";
import { asArray } from "@/lib/as-array";
import { Hazard } from "@/components/chrome";
import { ShieldCheck } from "lucide-react";

interface Alert { level: "info" | "warn" | "high"; icon: string; text: string }

/**
 * What needs him, ranked.
 *
 * This was a flat row of chips in source order, so a "high" sat wherever the
 * route happened to emit it and the eye had to read all of them to find the
 * one that mattered. Three changes make it a status board rather than a list:
 *
 *  - Ranked by severity, then alphabetically inside a tier, so position
 *    carries meaning and the order is stable between refreshes. A board that
 *    reshuffles on every poll cannot be skimmed.
 *  - A tally in the header — "1 HIGH · 3 WARN" — which is the answer to "do I
 *    need to read this" without reading it.
 *  - Severity on a reserved status ramp, never the series palette, and always
 *    with the tier's word beside it. Status colour is never the only cue.
 */
export function SitrepBand({ compact = false }: { compact?: boolean } = {}) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [read, setRead] = useState<string | null>(null);
  const [at, setAt] = useState("");

  /**
   * Live, rather than every five minutes.
   *
   * A strip whose whole purpose is "what needs attention right now" was
   * refreshing on a five-minute timer against a five-minute cache — so in the
   * worst case it told you an event was in ninety minutes when it had already
   * started. Thirty seconds, and paused entirely while the tab is hidden,
   * because a background tab polling forever is how a free tier dies.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = () =>
      fetch("/api/sitrep")
        .then((r) => r.json())
        .then((j) => { setAlerts(asArray(j.data)); setRead(typeof j.read === "string" ? j.read : null); setAt(j.at ?? ""); })
        .catch(() => setAlerts([]));

    const start = () => { if (!timer) timer = setInterval(load, 30_000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const onVisibility = () => {
      if (document.hidden) stop();
      else { void load(); start(); }
    };

    void load();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  /*
   * Nothing to report is a report.
   *
   * This returned null in two cases — still loading, and nothing wrong — while
   * the grid cell around it kept its 358×213. So the dashboard had a black
   * rectangle in its top-left corner most of the time, and the one state it
   * was drawing that way was the *good* one. An all-clear that looks identical
   * to a panel that failed to render teaches you to distrust the panel.
   *
   * On the wall it now says so. Outside the wall (the full-width strip further
   * down the page) it still collapses, because a band that spans the screen to
   * say "all clear" is just a bar taking up room.
   */
  if (!alerts || alerts.length === 0) {
    if (!compact) return null;
    return (
      <div className="cell sitrep-cell">
        <div className="bh"><span className="t">Sitrep</span><span className="i">SIT</span><span className="r">{at || "—"}</span></div>
        {alerts === null ? (
          <div className="tile-wait">READING…</div>
        ) : (
          <div className="empty-state">
            <ShieldCheck className="es-mark size-5" strokeWidth={1.5} />
            <div className="es-t">Nothing needs you</div>
            <div className="es-d">No overdue work, no deadlines close, no alerts standing.</div>
          </div>
        )}
      </div>
    );
  }

  /* The hazard rule appears only when something is actually at the high tier.
     A stripe that is always on is wallpaper, and wallpaper is not a warning. */
  const worst = alerts.some((a) => a.level === "high") ? "danger"
    : alerts.some((a) => a.level === "warn") ? "signal" : null;

  const RANK: Record<Alert["level"], number> = { high: 0, warn: 1, info: 2 };
  const ranked = [...alerts].sort((a, b) => RANK[a.level] - RANK[b.level] || a.text.localeCompare(b.text));
  const count = (l: Alert["level"]) => alerts.filter((a) => a.level === l).length;
  const tally = (["high", "warn", "info"] as const)
    .filter((l) => count(l) > 0)
    .map((l) => `${count(l)} ${l.toUpperCase()}`)
    .join(" · ");

  // Compact form lives inside the dashboard rail, where vertical space is tight.
  if (compact) {
    return (
      <div className="cell sitrep-cell">
        {worst && <Hazard tone={worst} />}
        <div className="bh">
          <span className="t">Sitrep</span>
          <span className="i">{tally}</span>
          <span className="r">{at}</span>
        </div>
        {/*
          The read sits above the rows, because it is the thing that says
          which row to look at. It is absent rather than filled with a
          placeholder when there is no model — a status board that pads itself
          teaches you to skim it.
        */}
        {read && <p className="sitrep-read">{read}</p>}
        <div className="sr-list">
          {ranked.map((a, i) => (
            <div className={`sr-row ${a.level}`} key={i}>
              {/* The tier's own word, not only its colour. */}
              <span className="sr-tier">{a.level === "high" ? "HIGH" : a.level === "warn" ? "WARN" : "INFO"}</span>
              <span className="sr-ic" aria-hidden>{a.icon}</span>
              <span className="sr-tx">{a.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="section" id="sitrep" style={{ paddingBottom: 0 }}>
      <div className="sectitle"><span className="sn">00</span><h2>Sitrep</h2><span className="line" /><span className="tag">{at} IST · WHAT NEEDS YOU</span></div>
      {worst && <Hazard tone={worst} />}
      {read && <p className="sitrep-read">{read}</p>}
      <div className="sitrep-row">
        {ranked.map((a, i) => (
          <div className={`sitrep-chip ${a.level}`} key={i}>
            <span className="sc-ic">{a.icon}</span>
            <span className="sc-tx">{a.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
