"use client";

import { useEffect, useState } from "react";

/**
 * SAGE's loading state.
 *
 * ── Why not a progress bar ────────────────────────────────────────────────
 *
 * The obvious version of this is a bar that fills. It is also a lie: nothing
 * here knows how far along a fetch is, so the bar would advance on a timer
 * unrelated to the thing it claims to measure. A readout that moves
 * independently of what it reports teaches you to stop believing the
 * instrument — and every other number in SAGE is real, so one theatrical
 * one is expensive.
 *
 * So this is honestly indeterminate: a scanning sweep, which reads as "in
 * progress" without implying a position, plus an elapsed counter, which is a
 * genuine measurement. The label names what is being fetched, so a panel that
 * sits here for a while tells you which source is slow rather than just that
 * something is.
 */
export function Acquiring({
  label = "DATA",
  className,
}: {
  /** What is being fetched — shown so a slow panel names its own source. */
  label?: string;
  className?: string;
}) {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setMs(Date.now() - started), 100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={`acq ${className ?? ""}`} role="status" aria-live="polite">
      <div className="rail">
        <span className="sig-dot on" />
        <span className="k">ACQUIRING</span>
        <span className="v">{label}</span>
        <span className="sep" />
        {/* Only shown once it is slow enough to be worth remarking on —
            a counter that appears instantly makes every fetch feel laboured. */}
        <span className="v">{ms > 1200 ? `${(ms / 1000).toFixed(1)}s` : ""}</span>
      </div>
      <div className="acq-scan" aria-hidden="true"><i /></div>
    </div>
  );
}
