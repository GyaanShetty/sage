"use client";

/**
 * The morning read, on the console.
 *
 * SAGE already writes the best thing it produces all day — the Synthesis
 * step of the morning block — and then leaves it on a page you have to
 * navigate to and step through nine screens to reach. By the time you are
 * at your desk it may as well not exist.
 *
 * This is that same synthesis, in the rail, with the ritual's progress
 * above it. Four things come back from the model and each gets its own
 * treatment, because they are not the same kind of statement:
 *
 *   · SUMMARY — prose. The read of the morning.
 *   · CONNECTIONS — the news tied to his own world. The part no feed can
 *     do, so it leads the lists.
 *   · WATCH — what to keep an eye on in the markets today.
 *   · ACTIONS — the only part that is a suggestion rather than an
 *     observation, so it is marked as one and sits last.
 *
 * It never generates on mount. The synthesis is a model call over the
 * whole morning's news; a panel that fires one every time the dashboard
 * loads would burn his free tier by lunchtime. It reads whatever the
 * morning block cached and offers a button.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Pane } from "@/components/pane";
import { asArray } from "@/lib/as-array";
import { useLive } from "@/lib/live";

interface Synthesis {
  summary: string;
  connections: string[];
  watch: string[];
  actions: string[];
}

/* The morning block's own store, read-only. Nine steps, and which of them
   were ticked today — the key and shape are owned by morning-block.tsx. */
const LS = "sage-morning";
const TOTAL_STEPS = 9;

const dayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
};

export function MorningTile({ n }: { n?: number }) {
  const [syn, setSyn] = useState<Synthesis | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none">("loading");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  /* Progress is local to the browser, so it is read here rather than
     fetched. A stored day that is not today means the block has not been
     started yet — not that it was abandoned. */
  useEffect(() => {
    const read = () => {
      try {
        const raw = JSON.parse(localStorage.getItem(LS) ?? "null");
        setDone(raw?.day === dayKey() ? asArray<string>(raw.ids).length : 0);
      } catch { setDone(0); }
    };
    read();
    /* The block runs in another tab as often as not. */
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("focus", read);
    };
  }, []);

  const read = useCallback((refresh = false) => {
    if (refresh) setBusy(true);
    return fetch(`/api/morning/synthesis${refresh ? "?refresh=1" : ""}`)
      .then((r) => r.json())
      .then((j) => {
        const d = j?.data as Synthesis | null;
        if (d?.summary) { setSyn(d); setState("ready"); }
        else setState("none");
      })
      .catch(() => setState("none"))
      .finally(() => setBusy(false));
  }, []);

  useLive(() => read(false), { onFocus: true });

  const pct = Math.round((done / TOTAL_STEPS) * 100);

  return (
    <Pane
      n={n}
      title="Morning"
      status={
        <span className="mt-hd">
          <span className="num">{done}/{TOTAL_STEPS}</span>
          <button
            className="mt-refresh"
            onClick={() => read(true)}
            disabled={busy}
            title="Re-read this morning"
            aria-label="Re-read this morning"
          ><RefreshCw className={`size-3${busy ? " mt-spin" : ""}`} /></button>
        </span>
      }
      live={done > 0 && done < TOTAL_STEPS}
    >
      <div className="mt">
        {/* The ritual's progress. Nine cells rather than a bar, because
            which steps are left is more useful than how far along. */}
        <Link className="mt-steps" href="/morning" title={`${done} of ${TOTAL_STEPS} steps done — open the morning block`}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <i key={i} className={i < done ? "on" : undefined} />
          ))}
          <span className="mt-pct num">{pct}%</span>
        </Link>

        {state === "loading" && <p className="mt-quiet">Reading the morning…</p>}
        {state === "none" && (
          <p className="mt-quiet">
            No synthesis yet — <Link className="mt-link" href="/morning">run the morning block</Link>
          </p>
        )}

        {state === "ready" && syn && (
          <>
            <p className="mt-sum">{syn.summary}</p>

            {syn.connections.length > 0 && (
              <section className="mt-sec">
                <h4 className="mt-k">Connections</h4>
                <ul className="mt-list">
                  {syn.connections.slice(0, 3).map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </section>
            )}

            {syn.watch.length > 0 && (
              <section className="mt-sec">
                <h4 className="mt-k">Watch</h4>
                <ul className="mt-list">
                  {syn.watch.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </section>
            )}

            {syn.actions.length > 0 && (
              <section className="mt-sec">
                {/* The only part of this that is advice rather than
                    observation, and it says so. */}
                <h4 className="mt-k mt-k-act">Suggested</h4>
                <ul className="mt-list mt-acts">
                  {syn.actions.slice(0, 4).map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </Pane>
  );
}
