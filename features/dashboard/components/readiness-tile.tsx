"use client";

/**
 * Why the rest of this screen is empty.
 *
 * Five modules on this console currently show nothing, and each of them
 * says so in its own words — "TickTick isn't connected", "no token",
 * "nothing logged". Individually those are honest. Together they are five
 * different ways of saying the same thing, spread across two rails, and
 * none of them tells you what to do about it.
 *
 * `/api/preflight` has known the whole answer all along: the verdict,
 * which keys are set, what each one costs when it is missing, how long
 * since the heartbeat last fired, and the outright traps. It was reachable
 * only by typing the URL.
 *
 * Three readings, in the order they matter:
 *
 *   · the HEARTBEAT, first and alone, because it is the one failure that
 *     makes SAGE a static page rather than an assistant — nothing runs,
 *     no brief is written, no reminder fires;
 *   · the TRAPS, which are not "missing features" but live problems. An
 *     empty SAGE_PASSWORD means anyone with the URL has everything, and
 *     that deserves to be on screen rather than in a JSON endpoint;
 *   · WHAT IS MISSING, by tier, each with the thing it costs — never a
 *     bare key name. "GITHUB_TOKEN" is a chore; "contribution graph and
 *     streak" is a reason.
 *
 * It never shows secret values. The endpoint only reports whether a key
 * is set, which is the only part that is safe on a screen.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Pane } from "@/components/pane";
import { asArray } from "@/lib/as-array";
import { useLive } from "@/lib/live";

interface Item { key: string; set: boolean; note: string }
interface Preflight {
  verdict: string;
  database: string;
  storedKeys: number;
  heartbeat: { lastBeat: string | null; ageMinutes: number | null; healthy: boolean };
  traps: string[];
  required: Item[];
  scheduled: Item[];
  durability: Item[];
  optional: Item[];
}

/* The tiers, loudest first. `optional` is deliberately last and dimmest:
   everything in it is a nice-to-have, and mixing it with the database
   being down is how a checklist stops being read. */
const TIERS: { k: keyof Preflight; label: string; weight: "hard" | "soft" }[] = [
  { k: "required",   label: "Required",   weight: "hard" },
  { k: "scheduled",  label: "Scheduled",  weight: "hard" },
  { k: "durability", label: "Durability", weight: "soft" },
  { k: "optional",   label: "Optional",   weight: "soft" },
];

const ago = (mins: number | null) => {
  if (mins == null) return "never";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export function ReadinessTile({ n }: { n?: number }) {
  const [pf, setPf] = useState<Preflight | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * Fifteen seconds, then give up and say so.
   *
   * Preflight checks the database by actually calling it, so when the
   * database is the thing that is wrong it answers slowly — measured at
   * 21s against an unreachable one. A panel that sits blank for twenty
   * seconds reads as broken, which is the opposite of what a panel about
   * what is broken should do. The endpoint also answers `ok: false` when
   * the news is bad, so the payload is read rather than the flag.
   */
  const load = useCallback(() =>
    fetch("/api/preflight", { signal: AbortSignal.timeout(15_000) })
      .then((r) => r.json())
      .then((j) => { const d = (j?.data ?? j) as Preflight; if (d?.verdict) { setPf(d); setFailed(false); } else setFailed(true); })
      .catch(() => setFailed(true)),
  []);

  /* Five minutes. These change when he edits an environment variable and
     redeploys, which is not a thing that needs a tighter loop. */
  useLive(load, { everyMs: 300_000 });

  const tiers = useMemo(() => TIERS.map((t) => {
    const items = asArray<Item>(pf?.[t.k]);
    return { ...t, items, missing: items.filter((i) => !i.set), total: items.length };
  }), [pf]);

  const hardMissing = tiers
    .filter((t) => t.weight === "hard")
    .reduce((a, t) => a + t.missing.length, 0);
  const beat = pf?.heartbeat;
  const allItems = tiers.reduce((a, t) => a + t.total, 0);
  const allSet = tiers.reduce((a, t) => a + (t.total - t.missing.length), 0);

  return (
    <Pane
      n={n}
      title="Readiness"
      status={
        pf
          ? hardMissing > 0 ? `${hardMissing} BLOCKING` : "READY"
          : failed ? "UNREACHABLE" : "CHECKING"
      }
      live={hardMissing > 0 || (pf != null && beat?.healthy === false)}
    >
      <div className="rd">
        {!pf && !failed && <p className="rd-quiet">Checking…</p>}
        {failed && !pf && <p className="rd-quiet">Preflight didn&rsquo;t answer in time</p>}

        {pf && (
          <>
            {/*
              The heartbeat, on its own and first. Everything else on this
              panel is a feature that is off; this is the one that makes
              SAGE stop being an assistant.
            */}
            <div className={`rd-beat${beat?.healthy ? " ok" : " bad"}`}>
              <span className="rd-beat-k">Heartbeat</span>
              <span className="rd-beat-v">{beat?.healthy ? "running" : "not running"}</span>
              <span className="rd-beat-t num">{ago(beat?.ageMinutes ?? null)}</span>
            </div>
            {!beat?.healthy && (
              <p className="rd-why">
                Nothing is driving the clock — no brief is written, no producer
                runs, no reminder fires.
              </p>
            )}

            {/* How much of the system is wired, as one bar. */}
            <div className="rd-bar" role="img"
                 aria-label={`${allSet} of ${allItems} settings configured`}>
              <i style={{ width: `${allItems ? (allSet / allItems) * 100 : 0}%` }} />
              <span className="rd-bar-k num">{allSet}/{allItems}</span>
            </div>

            {pf.traps.length > 0 && (
              <ul className="rd-traps">
                {pf.traps.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}

            <div className="rd-tiers">
              {tiers.filter((t) => t.missing.length > 0).map((t) => (
                <section className={`rd-tier ${t.weight}`} key={t.k}>
                  <h4 className="rd-tier-k">
                    {t.label}
                    <span className="num">{t.missing.length}/{t.total}</span>
                  </h4>
                  <ul className="rd-list">
                    {/* The cost, not the key name — a key is a chore, a
                        missing contribution graph is a reason. The key is
                        the title attribute for when he goes to set it. */}
                    {t.missing.slice(0, 4).map((i) => (
                      <li key={i.key} title={i.key}>{i.note}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <Link className="rd-go" href="/settings">Settings →</Link>
          </>
        )}
      </div>
    </Pane>
  );
}
