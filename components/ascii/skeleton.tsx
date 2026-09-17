"use client";

/**
 * What a pane shows before its first reading arrives.
 *
 * Not a grey box pulsing on a loop. A grey box tells you nothing and pulses
 * at the same rate whether the request is quick or hung; this says what is
 * being fetched and sweeps while it waits, so a pane stuck here for ten
 * seconds looks different from one that flickered through.
 *
 * Strictly for "has not answered yet". A pane that answered with nothing gets
 * Empty, which offers the move that fixes it — see components/pane.tsx.
 */

import { AsciiScan, AsciiSpinner } from "@/components/ascii/motifs";

export function AsciiSkeleton({ what, rows = 3 }: { what?: string; rows?: number }) {
  return (
    <div className="asc-skel" role="status" aria-live="polite">
      <span className="asc-skel-t">
        <AsciiSpinner /> {what ? `ACQUIRING ${what.toUpperCase()}` : "ACQUIRING"}
      </span>
      <AsciiScan width={30} className="asc-skel-scan" />
      {/* Ghost rows at the shape of the content that is coming, so the pane
          does not jump when it lands. */}
      <div className="asc-skel-rows" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="asc-skel-row" style={{ width: `${88 - i * 17}%` }} />
        ))}
      </div>
    </div>
  );
}
