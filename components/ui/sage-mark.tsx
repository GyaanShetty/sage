"use client";

import { cn } from "@/lib/utils";

/**
 * The SAGE mark — a bold G with an S cutting through its bowl.
 *
 * This one is traced from Gyaan's artwork rather than redrawn by eye. Three
 * hand approximations went in the bin first: a logo that is nearly the
 * letterform is worse than no logo at all, because it reads as a copy. The
 * source PNG was cropped to its ink box, upsampled, lightly blurred to take
 * the stair-steps off the curves, thresholded and run through potrace; the
 * result was then mapped onto the same 100-unit grid the old mark used, so
 * every call site and the icon generator keep working unchanged.
 *
 * One path, `fill-rule="evenodd"`, `currentColor` — so the counters are real
 * holes rather than background-coloured patches, and the mark is correct on a
 * launcher tile, in a notification and on anything light. (The previous mark
 * learned that lesson the hard way.)
 *
 * It needs about 24px to hold together: below that the gap between the S and
 * the bowl closes and it goes to a blob. That is a property of the artwork,
 * not of the trace — both call sites are sized above the floor.
 *
 * The animation hooks are unchanged: `.sage-mark__seg` breathes on hover and
 * `--online` glows, so the status bar behaves exactly as it did.
 */
const MARK = `
M 44.82 0.1 c -0.09 0.06 -1.13 0.26 -2.3 0.46 -8.25 1.41 -17.7 5.63 -24.42 10.94 -2.63
2.06 -7.55 7.48 -9.49 10.44 -3.86 5.86 -6.64 12.55 -7.96 19.16 -0.23 1.11 -0.46 2.11
-0.52 2.22 -0.21 0.38 -0.15 13.2 0.06 13.8 0.1 0.26 0.33 1.26 0.52 2.19 2.71 13.63
10.66 25.4 22.35 33.11 6.04 3.97 12.25 6.16 19.99 7.05 0.89 0.1 2 0.26 2.48 0.36 1.26
0.23 6.56 0.23 7.66 -0.01 0.45 -0.09 1.8 -0.33 3 -0.52 12.83 -2.04 24.55 -8.68 33.18
-18.78 4.62 -5.41 8.63 -14.1 9.95 -21.54 0.13 -0.73 0.35 -1.74 0.47 -2.24 0.22 -0.86
0.23 -1.26 0.23 -7.34 0 -6.42 0 -6.42 -0.36 -6.54 -0.48 -0.16 -41.65 -0.18 -42.09
-0.01 -0.45 0.17 -0.38 0.61 0.26 1.71 1.61 2.71 3.29 4.48 7.32 7.73 1.37 1.12 0.48
1.04 11.21 1.05 10.46 -0 9.83 -0.05 9.83 0.73 0 0.4 -0.43 2.7 -0.79 4.23 -1.3 5.51
-4.72 11.68 -8.93 16.09 -1.73 1.82 -2.02 1.89 -2.3 0.53 -1.49 -7.15 -4.47 -11.36
-11.65 -16.47 -1.19 -0.84 -2.7 -1.69 -5.47 -3.11 -4.39 -2.22 -6.29 -2.94 -13.02 -4.86
-7.79 -2.22 -11.01 -3.63 -14.72 -6.39 -8.26 -6.16 -7.56 -17.14 1.53 -23.96 1.88 -1.42
2.17 -1.59 4.16 -2.58 7.5 -3.73 14.42 -4.65 23.09 -3.06 9.67 1.77 19.12 8.51 23.74
16.94 0.86 1.57 0.12 1.43 8.01 1.43 4.5 -0 6.94 -0.05 7.09 -0.12 0.88 -0.47 -1.57
-6.08 -4.74 -10.83 -4.46 -6.71 -9.84 -11.69 -16.94 -15.69 -4.62 -2.62 -10.28 -4.6
-16.19 -5.68 -0.89 -0.16 -1.76 -0.35 -1.95 -0.4 -0.41 -0.14 -12.04 -0.15 -12.28 -0.01
z m -30.39 45.37 c 0.09 0.12 0.35 0.52 0.55 0.9 3.18 5.75 8.94 9.39 19.9 12.57 3.02
0.88 4.26 1.23 6.2 1.81 11.81 3.53 19.22 10.06 19.23 16.96 0.02 8.08 -8.7 10.92 -21.79
7.13 -14.16 -4.1 -24.94 -19.03 -24.97 -34.55 0 -4.02 0.26 -5.52 0.88 -4.82 z
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
        <path d={MARK} fillRule="evenodd" className="sage-mark__core" />
      </g>
    </svg>
  );
}

/** The geometry, for the icon generator and anywhere else that needs it. */
export const MARK_PATHS = { MARK };
