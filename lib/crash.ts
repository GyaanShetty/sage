/**
 * What to do about an error that reached a boundary.
 *
 * Two kinds of failure arrive at the same place and need opposite responses,
 * and telling them apart is the whole reason this exists.
 *
 * A **stale chunk** is not a bug in SAGE. The desktop app holds a tab open for
 * days; ship six deploys in a day and that tab is still holding an HTML shell
 * that asks for JavaScript filenames the new deploy no longer has. The fetch
 * 404s, React throws, and the page dies — with nothing wrong in the code. It
 * cannot be fixed by re-rendering, because the code needed to render was never
 * loaded. The only repair is to fetch the current shell: a hard reload.
 *
 * A **real error** must not reload. A reload re-runs the render that just
 * threw, throws again, and reloads again — a loop that burns the tab and hides
 * the bug. Real errors get shown.
 *
 * Hence the one-shot flag. Even a genuine stale chunk gets exactly one
 * automatic reload per session, so a deploy that is actually broken degrades to
 * a visible message rather than a machine spinning.
 */

const FLAG = "sage:chunk-reload";

export function isChunkError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? "";
  const msg = e?.message ?? "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk \S+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    // Safari and Firefox phrase a failed module fetch differently, and the
    // iPhone is the client this happens on most.
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

/**
 * Reload once for a stale chunk. Returns true if a reload was started, in
 * which case the caller should render nothing — the page is on its way out.
 */
export function recoverFromStaleChunk(err: unknown): boolean {
  if (typeof window === "undefined" || !isChunkError(err)) return false;
  try {
    if (sessionStorage.getItem(FLAG)) return false;
    sessionStorage.setItem(FLAG, String(Date.now()));
  } catch {
    // Private mode, storage disabled. Without the flag a reload could loop, so
    // the safe answer is to show the error instead.
    return false;
  }
  window.location.reload();
  return true;
}

/** Called once the app has rendered, so the next stale deploy gets its reload. */
export function clearStaleChunkFlag(): void {
  try { sessionStorage.removeItem(FLAG); } catch { /* nothing to clear */ }
}

/**
 * Tell the server a boundary fired.
 *
 * The boundaries are the only place a fatal render error is *known* rather
 * than guessed at: `window.onerror` sees a minified message with no route and
 * no digest, which is exactly the report that cannot be acted on. This posts
 * the same shape ErrorReporter does, to the same endpoint, so a crash on his
 * phone at 8am is a row I can read rather than a photograph he has to send.
 */
export function reportCrash(err: Error & { digest?: string }, where: string): void {
  if (typeof window === "undefined") return;
  void fetch("/api/ops", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: err.message || "Unknown render error",
      stack: err.stack,
      where,
      side: "client",
      context: {
        url: location.pathname,
        digest: err.digest,
        chunk: isChunkError(err),
        ua: navigator.userAgent.slice(0, 120),
      },
    }),
    keepalive: true,
  }).catch(() => {});
}
