"use client";

/**
 * What is in the air, right now.
 *
 * The reference's counter block — flights, ships, satellites, cyber events —
 * with the one of the four that has an open source behind it. Ships need paid
 * AIS, and there is no such thing as a live count of "cyber events"; inventing
 * either would make the two real numbers untrustworthy by association.
 */

import { useEffect, useState } from "react";
import { Pane, Empty } from "@/components/pane";
import { useFeed } from "@/lib/feed";
import { Fresh } from "@/components/fresh";
import { AsciiPlate } from "@/components/ascii/plate";

interface Skies { tracked: number; airborne: number; overIndia: number; ceilingM: number; at: number }
interface Envelope { ok: boolean; error?: string; authed?: boolean; stale?: boolean; data?: Skies }

const group = (v: number) => v.toLocaleString("en-US");

export function SkiesPanel({ n }: { n?: number }) {
  // The whole envelope, not just the data: when this fails the reason is the
  // only useful thing on the panel, and picking `.data` throws it away.
  // Ten minutes, and deliberately not on mount alongside everything else: a
  // cold instance pays for a 2.1MB upstream download, and that must not be
  // one of the dozen requests the dashboard fires while it is drawing.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const feed = useFeed<Envelope>(armed ? "/api/skies" : null, {
    everyMs: 10 * 60_000,
    pick: (j) => (j && typeof j === "object" ? (j as Envelope) : null),
  });
  const d = feed.data?.data;
  const problem = feed.data?.error;

  return (
    <Pane n={n} title="Traffic" status={<Fresh feed={feed} maxAgeMs={30 * 60_000} />} live={!!d}>
      {/* The reason matters: a quota you can fix with a free account is a
          different problem from OpenSky being down, and "no contact" for both
          tells you nothing you can act on. */}
      {!d
        ? <Empty reason={problem ? `Air traffic: ${problem}` : "Reading the air-traffic feed"} plate="orbit" />
        : (
          <div className="sky">
            <AsciiPlate kind="orbit" className="sky-plate" />
            <div className="sky-figs">
              <span><b>{group(d.airborne)}</b><i>AIRBORNE</i></span>
              <span><b>{group(d.overIndia)}</b><i>OVER INDIA</i></span>
              <span><b>{group(d.tracked)}</b><i>TRACKED</i></span>
              <span><b>{(d.ceilingM / 1000).toFixed(1)}<em>KM</em></b><i>CEILING</i></span>
            </div>
            <p className="sky-note">
              {feed.data?.stale && problem ? `Last good reading — ${problem}. ` : ""}
              Open state vectors, OpenSky Network. Ships and cyber counts have
              no open source and are not shown.
            </p>
          </div>
        )}
    </Pane>
  );
}
