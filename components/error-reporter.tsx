"use client";

import { useEffect } from "react";
import { clearStaleChunkFlag } from "@/lib/crash";

/**
 * Ship uncaught client errors to /api/ops.
 *
 * Deliberately quiet: it never renders, never blocks, and swallows its own
 * failures — an error reporter that throws is worse than none. Reports are
 * deduped in-session so one broken render loop does not post a thousand times
 * before the server has a chance to group them.
 */
const SEEN = new Set<string>();

function report(message: string, stack: string | undefined, where: string) {
  const key = `${where}|${message}`.slice(0, 300);
  if (SEEN.has(key)) return;
  SEEN.add(key);
  // Ignore the noise that every web app generates and nobody can fix.
  if (/ResizeObserver loop|Script error\.?$|Load failed|NetworkError|AbortError/i.test(message)) return;

  void fetch("/api/ops", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message, stack, where, side: "client",
      context: { url: location.pathname, ua: navigator.userAgent.slice(0, 120) },
    }),
    keepalive: true,   // survives the navigation that often follows a crash
  }).catch(() => {});
}

export function ErrorReporter() {
  useEffect(() => {
    // The shell mounted, so whatever chunk was stale has been replaced. Arm the
    // one-shot reload again for the next deploy that lands under an open tab.
    clearStaleChunkFlag();

    const onError = (e: ErrorEvent) => report(e.message, e.error?.stack, e.filename || "window");
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report(
        r instanceof Error ? r.message : String(r).slice(0, 300),
        r instanceof Error ? r.stack : undefined,
        "unhandled-rejection",
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
