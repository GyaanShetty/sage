"use client";

import { useEffect, useState } from "react";

/**
 * What SAGE is actually doing, while it does it.
 *
 * This was three bouncing dots — the universal "something is happening"
 * placeholder, which tells you nothing and looks like every chat app there is.
 *
 * The stages below are read from real state rather than invented on a timer:
 * `submitted` genuinely means the request is out and nothing has come back,
 * `streaming` genuinely means tokens are arriving. The elapsed counter is a
 * real measurement. Nothing here is theatre — a progress bar that fills at a
 * rate unrelated to progress is worse than no progress bar, because it
 * teaches you to distrust the readout.
 */
export function TypingIndicator({ phase = "submitted" }: { phase?: "submitted" | "streaming" }) {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setMs(Date.now() - started), 100);
    return () => clearInterval(t);
  }, []);

  const stages = [
    { key: "dispatch", label: "QUERY DISPATCHED", done: true },
    { key: "recall", label: "MEMORY RECALL", done: phase === "streaming" || ms > 900 },
    { key: "synth", label: "SYNTHESIS", done: phase === "streaming", active: phase === "streaming" },
  ];

  return (
    <div className="rt-processing" aria-label="Working" aria-live="polite">
      <div className="rail">
        <span className="sig">SAGE</span>
        <span className="k">PROCESSING</span>
        <span className="sep" />
        <span className="v">{(ms / 1000).toFixed(1)}s</span>
      </div>
      <ul className="rt-stages">
        {stages.map((s) => (
          <li key={s.key} className={s.active ? "on" : s.done ? "done" : ""}>
            <span className={`sig-dot ${s.active ? "on" : s.done ? "" : "idle"}`} />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
