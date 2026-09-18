"use client";

/**
 * ASCII plates: art that fills a panel which would otherwise be a void.
 *
 * Not decoration for its own sake — each plate is drawn from the pane's own
 * subject, so a quiet panel still looks like the instrument it is rather than
 * a hole where one should be. They sit behind whatever content arrives and
 * fade as soon as there is something real to read, which is the whole point:
 * the art is what a panel does while it waits.
 */

import { useAsciiFrame } from "@/lib/ascii-clock";

const PLATES: Record<string, string[]> = {
  /* an inbox: stacked envelopes */
  mail: [
    "  ┌───────────────┐  ",
    "  │╲             ╱│  ",
    "  │ ╲───────────╱ │  ",
    "  └───────────────┘  ",
    " ┌───────────────┐   ",
    " │╲             ╱│   ",
    " │ ╲───────────╱ │   ",
    " └───────────────┘   ",
  ],
  /* a satellite over a horizon */
  orbit: [
    "        ▁▁▁        ",
    "      ╱     ╲      ",
    "    ╱    ◦    ╲    ",
    "   │     │     │   ",
    "    ╲    │    ╱    ",
    "      ╲▁▁▁▁▁╱      ",
    "   ═══════════════ ",
  ],
  /* a waveform at rest */
  signal: [
    "▁▁▂▃▅▂▁▁▂▅▇▅▂▁▁▂▃▁▁",
    "                   ",
    "  ·  ·  ·  ·  ·  · ",
  ],
  /* an empty ledger */
  ledger: [
    "┌─────┬─────┬─────┐",
    "│     │     │     │",
    "├─────┼─────┼─────┤",
    "│     │     │     │",
    "└─────┴─────┴─────┘",
  ],
  /* a node graph */
  mesh: [
    "   ◦───────◦   ",
    "  ╱ ╲     ╱ ╲  ",
    " ◦   ╲   ╱   ◦ ",
    "  ╲   ╲ ╱   ╱  ",
    "   ╲   ◦   ╱   ",
    "    ◦─────◦    ",
  ],
};

export type PlateKind = keyof typeof PLATES;

export function AsciiPlate({ kind, className }: { kind: PlateKind; className?: string }) {
  const frame = useAsciiFrame();
  const lines = PLATES[kind] ?? PLATES.signal;
  // One row breathes at a time, very slowly — enough that the plate is not a
  // static image, not so much that it competes with anything real.
  const lit = Math.floor(frame / 8) % lines.length;

  return (
    <pre className={`asc-plate${className ? ` ${className}` : ""}`} aria-hidden>
      {lines.map((l, i) => (
        <span key={i} className={i === lit ? "on" : undefined}>{l}{"\n"}</span>
      ))}
    </pre>
  );
}
