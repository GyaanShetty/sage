"use client";

import { useEffect, useRef } from "react";
import { animate, useInView } from "framer-motion";

/** Numbers that count up when they enter view or change — nothing sits static. */
export function NumberTicker({
  value,
  format,
  duration = 1.1,
}: {
  value: number;
  format?: (v: number) => string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const prevRef = useRef(0);

  useEffect(() => {
    if (!inView || !ref.current) return;
    const from = prevRef.current;
    prevRef.current = value;
    const fmt = format ?? ((v: number) => Math.round(v).toLocaleString("en-IN"));
    const controls = animate(from, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = fmt(v);
      },
    });
    return () => controls.stop();
  }, [value, inView, format, duration]);

  return <span ref={ref}>{format ? format(0) : "0"}</span>;
}
