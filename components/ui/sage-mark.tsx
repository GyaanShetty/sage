"use client";

import { cn } from "@/lib/utils";

/**
 * The SAGE mark — a crowned, armoured figure with a cross set in the diamond
 * at its brow, standing on steps.
 *
 * Redrawn from Gyaan's artwork rather than traced from it: the upload has
 * never reached the repository, so this is a vector reconstruction on a
 * 100-unit grid. Every coordinate is symmetric about x = 50, which a traced
 * outline never is — and that asymmetry shows first at 14px in the status bar,
 * which is where the mark is used most.
 *
 * Built from real shapes with real holes (`fill-rule="evenodd"`) rather than
 * by painting background-coloured patches over it. The previous version cut
 * its cross with `fill: var(--background)`, which meant the mark was only
 * correct on SAGE's own background and became a solid blob anywhere else — on
 * a launcher tile, in a notification, on anything light.
 *
 * The animation hooks are unchanged: `.sage-mark__seg` breathes on hover and
 * `--online` glows, so the status bar behaves exactly as it did.
 */

/** The head: a narrow armoured mask, widest at the brow, with a diamond cut
 *  at the brow and a visor slot either side. */
const HEAD = `
M 50 1 L 56 19 L 61.5 26 L 59 47 L 50 63 L 41 47 L 38.5 26 L 44 19 Z
M 50 21.5 L 58.5 30 L 50 38.5 L 41.5 30 Z
M 41.5 40 L 47.5 47.5 L 45 51.5 L 40 43.5 Z
M 58.5 40 L 52.5 47.5 L 55 51.5 L 60 43.5 Z
`;

const CROSS = `
M 48.2 25.2 L 51.8 25.2 L 51.8 28.4 L 55 28.4 L 55 31.6 L 51.8 31.6
L 51.8 34.8 L 48.2 34.8 L 48.2 31.6 L 45 31.6 L 45 28.4 L 48.2 28.4 Z
`;

/* The wings sweep up and out, tips clearing the spire — which is what makes
   this read as a crown rather than as wings on a bird. */
const WING_R = `M 56.5 30 C 66 22, 76 13, 88 3 C 86 21, 78 40, 65.5 53 L 59 43 Z`;
const WING_L = `M 43.5 30 C 34 22, 24 13, 12 3 C 14 21, 22 40, 34.5 53 L 41 43 Z`;
const SPIKE_R = `M 54.5 14 L 63 8 L 60.5 30 Z`;
const SPIKE_L = `M 45.5 14 L 37 8 L 39.5 30 Z`;

/** Narrow at the waist, concave out to sharp points, standing on two steps. */
const ROBE = `
M 43 54 L 57 54 L 58.5 66
C 63 72, 70 80, 74 88 L 80 97 L 20 97 L 26 88
C 30 80, 37 72, 41.5 66 Z
M 48.8 63 L 51.2 63 L 52.1 97 L 47.9 97 Z
M 27.5 87.5 L 72.5 87.5 L 73.9 90.3 L 26.1 90.3 Z
M 24.2 92.4 L 75.8 92.4 L 77.2 95.2 L 22.8 95.2 Z
`;

export function SageMark({
  size = 22,
  online = false,
  className,
}: {
  size?: number;
  online?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={cn("sage-mark", online && "sage-mark--online", className)}
      aria-hidden
    >
      <g fill="currentColor" className="sage-mark__seg">
        <path d={WING_L} className="s s-tl" />
        <path d={WING_R} className="s s-tr" />
        <path d={SPIKE_L} />
        <path d={SPIKE_R} />
        <path d={HEAD} fillRule="evenodd" />
        <path d={CROSS} className="sage-mark__core" />
        <path d={ROBE} fillRule="evenodd" />
      </g>
    </svg>
  );
}

/** The geometry, for the icon generator and anywhere else that needs it. */
export const MARK_PATHS = { HEAD, CROSS, WING_L, WING_R, SPIKE_L, SPIKE_R, ROBE };
