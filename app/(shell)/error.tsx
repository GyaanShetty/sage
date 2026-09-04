"use client";

import { useEffect } from "react";
import { recoverFromStaleChunk, reportCrash } from "@/lib/crash";

/**
 * The boundary that matters most, because it is the one that fires.
 *
 * A route boundary inside the shell fails only the page. The nav, the clock,
 * the launcher and the status bar stay mounted and working, so a page that
 * throws costs one page rather than the application — the same bargain
 * TileGuard makes for a single pane, one level up.
 *
 * `reset()` re-renders the route. That genuinely fixes the common case, which
 * is a tile that read one bad payload from an endpoint that is fine on the
 * next request.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // A stale chunk is not worth reporting: it is a deploy artefact, not a bug.
    if (!recoverFromStaleChunk(error)) reportCrash(error, "shell-error");
  }, [error]);

  return (
    <section className="pane" style={{ margin: 12 }}>
      <header className="pane-hd">
        <span className="pane-t"><span className="pane-n">!!)</span>Page fault</span>
        <span className="pane-s live">HELD</span>
      </header>
      <div className="pane-body" style={{ display: "grid", gap: 10, padding: 12 }}>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, opacity: 0.75 }}>
          This screen stopped rendering. The rest of SAGE is still running — the
          fault was contained to this page.
        </p>
        <pre style={{ margin: 0, padding: 8, border: "1px solid var(--rule)", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {error.message || "No message."}
          {error.digest ? `\n\ndigest ${error.digest}` : ""}
        </pre>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="pfm-go" onClick={reset}>RETRY</button>
          <button className="pfm-go" onClick={() => window.location.reload()}>RELOAD</button>
        </div>
      </div>
    </section>
  );
}
