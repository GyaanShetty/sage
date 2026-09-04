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

"use client";

import { useState, type ReactNode } from "react";
import { Brackets, Hazard } from "@/components/chrome";
import { ExpandModal } from "@/components/expand-modal";
import { TileGuard } from "@/components/tile-guard";

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
  /**
   * An editor for whatever this pane shows.
   *
   * Rendered only inside the magnified view, which is the rule the feeds add
   * field already set: a text input in a 200px pane is forty pixels wide and
   * unusable, and editing is rare while reading is constant. Its presence
   * puts a + in the header, which opens the same modal magnify uses — one
   * overlay, one piece of state.
   */
  edit?: ReactNode;
  /**
   * Suppress the magnify control.
   *
   * On by default, because the whole point of a wall this dense is that
   * everything is a glance and anything worth reading properly is one click
   * from being readable. Off for the map, which is already interactive and
   * would lose its state on a remount.
   */
  noZoom?: boolean;
  children: ReactNode;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function Pane({ n, title, status, live, className, bare, frame, alert, noZoom, edit, children }: PaneProps) {
  const [zoom, setZoom] = useState(false);

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
          {edit && (
            <button className="pane-zoom pane-add" onClick={() => setZoom(true)} aria-label={`Add to ${title}`}>+</button>
          )}
          {!noZoom && (
            <button className="pane-zoom" onClick={() => setZoom(true)} aria-label={`Magnify ${title}`}>⤢</button>
          )}
        </header>
      )}
      {/*
        Every pane guards its own body.

        TileGuard was applied by hand at the call sites, which meant coverage
        was a matter of remembering — and six panes on the wall (the map, the
        focus cycle, deadlines, what now, gita, the month) were never wrapped.
        A throw in any of them unmounted the whole application and produced
        Next's white "a client-side exception has occurred" page.

        Guarding here instead makes it structural: a pane cannot be added
        without the guard, because the guard is part of what a pane is. The
        outer TileGuards at the call sites stay and simply never fire first —
        they are the fallback for a tile that throws before it renders a Pane
        at all.
      */}
      <div className="pane-body">
        <TileGuard bare name={title}>{children}</TileGuard>
      </div>

      {/*
        The magnified copy renders the same children rather than a second,
        richer view. Two renderings of one pane drift apart — the big one gets
        a field the small one never grows — and then the number you checked at
        a glance and the number you opened to read disagree.
      */}
      {(!noZoom || edit) && (
        <ExpandModal
          open={zoom}
          onClose={() => setZoom(false)}
          title={title}
          tag={n !== undefined ? `PANE ${pad(n)}` : undefined}
        >
          <div className="pane-mag">
            {edit}
            <TileGuard bare name={title}>{children}</TileGuard>
          </div>
        </ExpandModal>
      )}
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

/**
 * An empty pane is a door, not a dead end.
 *
 * "NO HOLDINGS" and "NO CONTRIBUTION DATA" tell you a pane is empty and
 * nothing else — not whether that is a problem, not whose problem, and not
 * what to do about it. On a wall of thirty panes that reads as a broken
 * dashboard, when in fact most of them are simply waiting on a thing only you
 * can do: connect an account, enter a holding, let a shortcut run.
 *
 * So an empty state states the reason and offers the next move. `href` makes
 * the whole thing a link to wherever the move happens.
 *
 * The distinction that matters: `Empty` is for "nothing here yet", which is a
 * standing condition. A pane that has not finished its first fetch is a
 * different state and stays as a plain wait — offering someone an action for
 * a request that is still in flight is how you get a dashboard full of
 * buttons that turn out to have been unnecessary two seconds later.
 */
export function Empty({ reason, action, href }: { reason: string; action?: string; href?: string }) {
  const body = (
    <>
      <span className="empty-r">{reason}</span>
      {action && <span className="empty-a">{action} →</span>}
    </>
  );
  return href
    ? <a className="empty is-link" href={href}>{body}</a>
    : <div className="empty">{body}</div>;
}
