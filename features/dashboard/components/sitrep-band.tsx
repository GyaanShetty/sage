"use client";

import { useEffect, useState } from "react";
import { asArray } from "@/lib/as-array";

interface Alert { level: "info" | "warn" | "high"; icon: string; text: string }

/** Proactive situation report strip — SAGE surfaces what needs attention. */
export function SitrepBand({ compact = false }: { compact?: boolean } = {}) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
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
        .then((j) => { setAlerts(asArray(j.data)); setAt(j.at ?? ""); })
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

  if (!alerts || alerts.length === 0) return null;

  // Compact form lives inside the dashboard rail, where vertical space is tight.
  if (compact) {
    return (
      <div className="cell sitrep-cell">
        <div className="bh"><span className="t">Sitrep</span><span className="i">SIT</span><span className="r">{at}</span></div>
        <div className="sitrep-row compact">
          {alerts.map((a, i) => (
            <div className={`sitrep-chip ${a.level}`} key={i}>
              <span className="sc-ic">{a.icon}</span>
              <span className="sc-tx">{a.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="section" id="sitrep" style={{ paddingBottom: 0 }}>
      <div className="sectitle"><span className="sn">00</span><h2>Sitrep</h2><span className="line" /><span className="tag">{at} IST · WHAT NEEDS YOU</span></div>
      <div className="sitrep-row">
        {alerts.map((a, i) => (
          <div className={`sitrep-chip ${a.level}`} key={i}>
            <span className="sc-ic">{a.icon}</span>
            <span className="sc-tx">{a.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
