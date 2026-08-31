"use client";

import { Component, type ReactNode } from "react";

/**
 * One broken tile must not take the whole app with it.
 *
 * React unmounts the entire tree on an uncaught render error, so a single
 * panel reading an unexpected payload shape produced "Application error: a
 * client-side exception has occurred" and a blank screen — the dashboard, the
 * map, the chrome, all of it, because one endpoint returned an object where a
 * list was expected.
 *
 * The dashboard is thirty independent readouts. Losing one of them should cost
 * exactly one panel, and the panel should say so rather than disappearing —
 * a missing tile is a puzzle, a tile that says it failed is a bug report.
 */
interface State { failed: boolean; message: string }

export class TileGuard extends Component<{ children: ReactNode; name?: string }, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(err: unknown): State {
    return { failed: true, message: String((err as Error)?.message ?? err).slice(0, 120) };
  }

  componentDidCatch(err: unknown) {
    // Reaches the existing error reporter, so a tile that fails on his machine
    // and not in testing is still visible to me.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sage:tile-error", {
        detail: { name: this.props.name, message: String((err as Error)?.message ?? err) },
      }));
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="pane">
        <header className="pane-hd">
          <span className="pane-t">{this.props.name ?? "PANEL"}</span>
          <span className="pane-s" style={{ color: "var(--down)" }}>FAILED</span>
        </header>
        <div className="pane-body">
          <div className="tile-wait" style={{ color: "var(--down)" }}>{this.state.message}</div>
        </div>
      </section>
    );
  }
}
