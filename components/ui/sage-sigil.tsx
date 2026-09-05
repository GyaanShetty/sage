"use client";

import { SageMark } from "@/components/ui/sage-mark";
import { cn } from "@/lib/utils";

/**
 * The mark, presented — a halo ring, orbiting arcs, and the four cardinal
 * words from the identity sheet.
 *
 * This is the mark used as a *centrepiece* rather than as a marker. The bare
 * SageMark is right at 14px in a status bar and looks lost at 200px on an
 * empty screen: at that size the eye wants somewhere for the mark to sit.
 *
 * Deliberately not on the dashboard. That wall is thirty panes on one screen
 * because he asked for it to be, and a hero in the middle of it would cost
 * four of them to say something he already knows. It belongs where the screen
 * is otherwise empty and the moment is an arrival — boot, and the lock screen.
 */
export function SageSigil({
  size = 200,
  className,
  words = true,
}: {
  size?: number;
  className?: string;
  /** The four operations, set around the ring. Off where space is tight. */
  words?: boolean;
}) {
  return (
    <div
      className={cn("sigil", className)}
      style={{ ["--sigil" as string]: `${size}px` }}
      aria-hidden
    >
      <span className="sigil-halo" />
      <span className="sigil-ring" />
      <span className="sigil-ring is-slow" />
      {/* Sized as a share of the ring rather than in pixels, so the mark
          still fills it when the caller scales the whole assembly in CSS. */}
      <SageMark size={0} online className="sigil-mark" />

      {words && (
        <>
          <span className="sigil-words is-left">
            <i>OBSERVE</i><i>ANALYSE</i><i>SYNTHESISE</i><i>ACT</i>
          </span>
          <span className="sigil-words is-right">
            <i>SYSTEMS</i><i>PEOPLE</i><i>DATA</i><i>OUTCOMES</i>
          </span>
        </>
      )}
    </div>
  );
}
