import type { Transition, Variants } from "framer-motion";

/** Motion tokens — every animation in SAGE uses these, nothing ad-hoc. */
export const springs = {
  /** Palette, hover, small controls */
  snappy: { type: "spring", stiffness: 400, damping: 30 } satisfies Transition,
  /** Panels, page transitions */
  smooth: { type: "spring", stiffness: 260, damping: 28 } satisfies Transition,
  /** Cards entering */
  gentle: { type: "spring", stiffness: 170, damping: 26 } satisfies Transition,
};

export const durations = { micro: 0.12, standard: 0.2, entrance: 0.35 };
export const STAGGER = 0.05;

export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: springs.smooth },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: STAGGER } },
};

export const paletteIn: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: springs.snappy },
  exit: { opacity: 0, scale: 0.98, transition: { duration: durations.micro } },
};
