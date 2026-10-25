"use client";

/**
 * The morning brief, on the console.
 *
 * SAGE has written one of these every morning for a while and then kept
 * it somewhere you had to go and look — which, for a sentence about
 * today, is the same as not writing it. It belongs on the screen that is
 * already open.
 *
 * It is prose, and it is the ONLY prose in the rails. Everything around
 * it is mono labels and tabular numbers, so a serif paragraph reads as a
 * different kind of thing — which it is: the one place SAGE talks rather
 * than reports. That contrast is deliberate and is why the type ceiling
 * in console.css makes an exception for it.
 *
 * Refresh is manual and marked. The brief costs a model call, and a
 * panel that silently regenerates on every mount is a panel that spends
 * his free tier while he reads it.
 */

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Pane } from "@/components/pane";
import { useLive } from "@/lib/live";

export function BriefTile({ n }: { n?: number }) {
  const [text, setText] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");
  const [busy, setBusy] = useState(false);

  const read = useCallback((refresh = false) => {
    if (refresh) setBusy(true);
    return fetch(`/api/brief${refresh ? "?refresh=1" : ""}`)
      .then((r) => r.json())
      .then((j) => {
        const t = typeof j?.data?.text === "string" ? j.data.text.trim() : "";
        setText(t || null);
        setCached(!!j?.data?.cached);
        setState(t ? "ready" : "none");
      })
      .catch(() => setState("none"))
      .finally(() => setBusy(false));
  }, []);

  /* Read on mount and on focus, but never on a timer: the window is six
     hours wide, so polling it would only ever re-fetch the same cached
     paragraph. */
  useLive(() => read(false), { onFocus: true });

  return (
    <Pane
      n={n}
      title="Brief"
      status={
        <button
          className="bt-refresh"
          onClick={() => read(true)}
          disabled={busy}
          title={cached ? "Cached — write a new one" : "Write a new one"}
          aria-label="Rewrite the brief"
        >
          <RefreshCw className={`size-3${busy ? " bt-spin" : ""}`} />
        </button>
      }
    >
      <div className="bt">
        {state === "loading" && <p className="bt-quiet">Reading…</p>}
        {state === "none" && (
          <p className="bt-quiet">
            No brief yet — it writes itself on the morning run.
          </p>
        )}
        {state === "ready" && text && <p className="bt-text">{text}</p>}
      </div>
    </Pane>
  );
}
