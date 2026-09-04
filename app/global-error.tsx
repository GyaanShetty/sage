"use client";

import { useEffect } from "react";
import { recoverFromStaleChunk, reportCrash } from "@/lib/crash";

/**
 * The outermost net.
 *
 * Without this file, a throw anywhere React cannot contain produces Next.js's
 * own fallback: a white page reading "Application error: a client-side
 * exception has occurred (see the browser console for more information)".
 * That is what Gyaan photographed. It is white, it is unbranded, it names
 * nothing, and its only advice is to open a console the desktop app does not
 * have.
 *
 * This replaces it with the same screen SAGE uses everywhere else, the actual
 * message, the digest to match against a server log, and a button. Styles are
 * inline on purpose: a boundary that depends on a stylesheet is useless in the
 * case where the stylesheet is what failed to load.
 *
 * global-error replaces the root layout entirely, so it must render <html> and
 * <body> itself.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // A stale chunk is not worth reporting: it is a deploy artefact, not a bug.
    if (!recoverFromStaleChunk(error)) reportCrash(error, "global-error");
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#070708", color: "#e7e7ea", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 560, width: "100%", border: "1px solid #26262b", background: "#0b0b0d" }}>
            <div style={{ borderBottom: "1px solid #26262b", padding: "8px 12px", fontSize: 11, letterSpacing: ".14em", color: "#ff3b30" }}>
              SAGE · UNHANDLED FAULT
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#a1a1aa" }}>
                SAGE stopped rendering. Nothing was lost — everything on the wall is
                read from the server on load, so a reload restores it.
              </p>
              <pre style={{ margin: 0, padding: 10, background: "#08080a", border: "1px solid #1c1c20", fontSize: 11, color: "#e7e7ea", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {error.message || "No message."}
                {error.digest ? `\n\ndigest ${error.digest}` : ""}
              </pre>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={reset} style={btn}>RETRY</button>
                <button onClick={() => window.location.assign("/dashboard")} style={btn}>DASHBOARD</button>
              </div>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}

const btn: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  background: "transparent",
  border: "1px solid #ff3b30",
  color: "#ff3b30",
  fontFamily: "inherit",
  fontSize: 11,
  letterSpacing: ".14em",
  cursor: "pointer",
};
