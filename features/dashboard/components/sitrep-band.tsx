"use client";

import { useEffect, useState } from "react";

interface Alert { level: "info" | "warn" | "high"; icon: string; text: string }

/** Proactive situation report strip — SAGE surfaces what needs attention. */
export function SitrepBand() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [at, setAt] = useState("");

  useEffect(() => {
    const load = () => fetch("/api/sitrep").then((r) => r.json()).then((j) => { setAlerts(j.data ?? []); setAt(j.at ?? ""); }).catch(() => setAlerts([]));
    load();
    const t = setInterval(load, 300000);
    return () => clearInterval(t);
  }, []);

  if (!alerts || alerts.length === 0) return null;

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
