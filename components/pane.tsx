/**
 * A terminal pane.
 *
 * Every tile in the interface is one of these: a numbered amber title on a
 * tinted band, an optional right-aligned status, and content packed to the
 * edges. No radius, no shadow, no translucency — a Bloomberg screen is tiled
 * panes divided by hairlines, and the frosted floating card is the exact thing
 * this design is moving away from.
 *
 * The number is not decoration. Panes are addressable: "look at 26" is a
 * faster instruction than "the biometrics one near the middle", which is the
 * entire reason real terminals number their screens.
 */

import type { ReactNode } from "react";
import { Brackets, Hazard } from "@/components/chrome";

export interface PaneProps {
  /** Screen number, shown as `NN)`. Stable per pane — it is an address. */
  n?: number;
  title: string;
  /** Right-aligned readout: SYNCED, 8 RUNS · TAIL -F, 41.2K/S, 4 FEEDS. */
  status?: ReactNode;
  /** Tints the status amber, for panes that are actively receiving. */
  live?: boolean;
  className?: string;
  /** Drop the header entirely — for a pane that is pure instrument. */
  bare?: boolean;
  /**
   * Corner brackets. Off by default: a screen where every pane is bracketed
   * reads as noise, so this marks the few that are worth looking at first.
   */
  frame?: boolean;
  /**
   * A real alert state, which draws the hazard rule. Not a style — passing
   * this when nothing is wrong is what makes the stripe stop meaning
   * anything.
   */
  alert?: "signal" | "danger";
  children: ReactNode;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function Pane({ n, title, status, live, className, bare, frame, alert, children }: PaneProps) {
  return (
    <section className={`pane${className ? ` ${className}` : ""}`}>
      {alert && <Hazard tone={alert} />}
      {frame && <Brackets tone={alert ?? "rule"} />}
      {!bare && (
        <header className="pane-hd">
          <span className="pane-t">
            {n !== undefined && <span className="pane-n">{pad(n)})</span>}
            {title}
          </span>
          {status !== undefined && (
            <span className={`pane-s${live ? " live" : ""}`}>{status}</span>
          )}
        </header>
      )}
      <div className="pane-body">{children}</div>
    </section>
  );
}

/**
 * A labelled figure — the unit the top strip and every stat block is made of.
 * Value first and large, key second and small: the ratio is the hierarchy, and
 * it is the one thing that stops a dense screen reading as a wall.
 */
export function Stat({ v, k, tone }: { v: ReactNode; k: string; tone?: "up" | "down" | "signal" }) {
  return (
    <div className="tstat">
      <span className={`tstat-v${tone ? ` ${tone}` : ""}`}>{v}</span>
      <span className="tstat-k">{k}</span>
    </div>
  );
}

/** A key/value row. Numbers right-aligned and tabular, always. */
export function Row({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: "up" | "down" | "signal" | "muted" }) {
  return (
    <div className="trow">
      <span className="trow-k">{k}</span>
      <span className={`trow-v${tone ? ` ${tone}` : ""}`}>{v}</span>
    </div>
  );
}
