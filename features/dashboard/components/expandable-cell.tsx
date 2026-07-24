"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { ExpandModal } from "@/components/expand-modal";

/**
 * Any dashboard panel wrapped in this gets a magnify affordance: a corner
 * button (and the whole header) opens an enlarged, elaborate view of the
 * same live content. Pass `expanded` to supply a richer editor instead.
 */
export function ExpandableCell({
  title,
  tag,
  className,
  style,
  children,
  expanded,
  hud,
}: {
  title: string;
  tag?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  expanded?: React.ReactNode;
  hud?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`cell xcell ${className ?? ""}`} style={style} data-hud={hud}>
      <button className="xc-btn" onClick={() => setOpen(true)} aria-label={`Expand ${title}`}>
        <Maximize2 className="size-3" />
      </button>
      {children}
      <ExpandModal open={open} onClose={() => setOpen(false)} title={title} tag={tag ?? "MAGNIFIED"}>
        <div className="xc-big">{expanded ?? children}</div>
      </ExpandModal>
    </div>
  );
}
