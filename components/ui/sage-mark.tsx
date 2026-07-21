"use client";

import { cn } from "@/lib/utils";

/**
 * SAGE identity mark — a diamond formed from four floating segments around a
 * still center point (a guiding star / focused mind). Monochrome, recognizable
 * at 16px. Animates on hover (segments breathe outward), glows when online.
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
      viewBox="0 0 24 24"
      fill="none"
      className={cn("sage-mark", online && "sage-mark--online", className)}
      aria-hidden
    >
      {/* four floating segments of a diamond (gaps at the corners) */}
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="sage-mark__seg">
        <path d="M12 3.2 L20 11" className="s s-tr" />
        <path d="M20.8 12 L13 20" className="s s-br" />
        <path d="M12 20.8 L4 13" className="s s-bl" />
        <path d="M3.2 12 L11 4" className="s s-tl" />
      </g>
      {/* center point */}
      <circle cx="12" cy="12" r="1.7" fill="currentColor" className="sage-mark__core" />
    </svg>
  );
}
