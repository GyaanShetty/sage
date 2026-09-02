"use client";

import { cn } from "@/lib/utils";

/**
 * SAGE identity mark — a crowned queen, with a cross set in the diamond at
 * her brow.
 *
 * Drawn as vector paths rather than traced from the source PNG, so it takes
 * `currentColor` and stays crisp at 14px in the status bar and at 512px as
 * the app icon. Every coordinate sits on a 100-unit grid, which is why the
 * two wings are exactly symmetrical about x = 50 — a traced outline never is,
 * and that asymmetry shows first at the small size, which is where the mark
 * is used most.
 *
 * The animation hooks the old diamond had are kept: `.sage-mark__seg`
 * breathes on hover and `--online` glows, so the status bar behaves exactly
 * as it did.
 */
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
        {/* Left wing of the crown, sweeping down to the collar. */}
        <path d="M14 12 L31 34 L38 30 L50 44 L34 44 L20 26 Z" className="s s-tl" />
        {/* Right wing, mirrored about x = 50. */}
        <path d="M86 12 L69 34 L62 30 L50 44 L66 44 L80 26 Z" className="s s-tr" />
        {/* Centre spire. */}
        <path d="M50 6 L60 28 L50 38 L40 28 Z" />
        {/* Collar: the V the two wings meet in. */}
        <path d="M32 42 L68 42 L50 62 Z" />
        {/* Stem, waisted like a chess queen rather than straight-sided. */}
        <path d="M43 58 H57 Q60 72 63 84 H37 Q40 72 43 58 Z" />
        {/* Two-step base. */}
        <path d="M35 86 H65 L67 92 H33 Z" />
        <path d="M31 94 H69 L71 99 H29 Z" />
      </g>
      {/* The cross is cut from the ground rather than drawn in a second
          colour, so the mark survives being placed on any background. */}
      <path
        d="M47 20 h6 v5 h5 v6 h-5 v5 h-6 v-5 h-5 v-6 h5 z"
        fill="var(--background, #08090b)"
        className="sage-mark__core"
      />
    </svg>
  );
}
