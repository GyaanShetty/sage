"use client";

/**
 * The parts of Gyaan's day that had no pane.
 *
 * He listed fourteen things he does daily and the wall carried about half of
 * them. Most of the rest already existed as tiles elsewhere in the tree and
 * only needed placing. These two did not exist at all: what he is paying for
 * every month, and the whiteboard he calls his main workspace.
 */

import { useState } from "react";
import Link from "next/link";
import { Pane, Empty } from "@/components/pane";
import { useLive } from "@/lib/live";
import { asArray } from "@/lib/as-array";
import { shareJson } from "@/lib/share";

const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/* ── subscriptions ─────────────────────────────────────────────────────────
 *
 * Not a list he maintains by hand — these are the charges the expense
 * scanner already flagged as recurring when it read the receipts out of his
 * mail. That matters: a subscription tracker you have to remember to update
 * is a subscription tracker that is wrong, and the whole reason this one is
 * worth having is that it finds the ₹149 nobody remembers agreeing to.
 *
 * Sorted by amount, because the question is never "what am I subscribed to",
 * it is "what is the expensive one".
 */
interface Sub { merchant: string; amount: number }

export function SubscriptionsTile({ n }: { n?: number }) {
  const [subs, setSubs] = useState<Sub[] | null | undefined>(undefined);

  /* shareJson, not fetch: the spend pane reads the same route in the same
     tick, and two identical requests to a route that scans receipts is one
     request wasted on every refresh. */
  useLive(
    () => shareJson<{ data?: { summary?: { recurring?: unknown } } }>("/api/expenses")
      .then((j) => setSubs(asArray<Sub>(j?.data?.summary?.recurring)))
      .catch(() => setSubs(null)),
    { everyMs: 600_000 },
  );

  const rows = [...(subs ?? [])].sort((a, b) => b.amount - a.amount);
  const monthly = rows.reduce((a, s) => a + s.amount, 0);

  return (
    <Pane
      n={n}
      title="Subscriptions"
      status={rows.length ? `${rows.length} recurring` : "none found"}
      live={rows.length > 0}
    >
      {subs === undefined && <div className="tile-wait">READING…</div>}
      {subs !== undefined && rows.length === 0 && (
        <Empty reason="No recurring charges found in the last 30 days" action="Scan receipts" href="/portfolio" />
      )}
      {rows.length > 0 && (
        <>
          <div className="tstat">
            <span className="tstat-v">{rupees(monthly)}</span>
            <span className="tstat-k">A MONTH, RECURRING</span>
          </div>
          {rows.slice(0, 8).map((s) => (
            <div className="sub-row" key={s.merchant}>
              <span className="sub-m">{s.merchant}</span>
              {/* A bar against the largest one, so the expensive subscription
                  is visible without reading eight numbers. */}
              <span className="sub-bar" aria-hidden>
                <i style={{ width: `${(s.amount / rows[0].amount) * 100}%` }} />
              </span>
              <span className="sub-a num">{rupees(s.amount)}</span>
            </div>
          ))}
        </>
      )}
    </Pane>
  );
}

/* ── the whiteboard ────────────────────────────────────────────────────────
 *
 * He calls the board his main workspace, and it was reachable only from the
 * nav rail. This is the index: the boards he has, newest first, each a link
 * straight into it, plus what is on it — a board with four nodes and a board
 * with two hundred are different objects and the count is the only thing
 * that distinguishes them at a glance.
 */
interface BoardRow { id: string; title: string; nodes: number; strokes: number; updatedAt: string }

const ago = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

export function WhiteboardTile({ n }: { n?: number }) {
  const [boards, setBoards] = useState<BoardRow[] | null | undefined>(undefined);

  useLive(
    () => fetch("/api/board").then((r) => r.json())
      .then((j) => setBoards(asArray<BoardRow>(j?.data)))
      .catch(() => setBoards(null)),
    { everyMs: 300_000 },
  );

  const rows = [...(boards ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return (
    <Pane
      n={n}
      title="Whiteboard"
      status={rows.length ? `${rows.length} board${rows.length === 1 ? "" : "s"}` : "empty"}
      live={rows.length > 0}
    >
      {boards === undefined && <div className="tile-wait">READING…</div>}
      {boards !== undefined && rows.length === 0 && (
        <Empty reason="No boards yet" action="Open the workspace" href="/workspace" />
      )}
      {rows.slice(0, 7).map((b) => (
        <Link className="wb-row" key={b.id} href={`/workspace?board=${encodeURIComponent(b.id)}`}>
          <span className="wb-t">{b.title || "Untitled"}</span>
          <span className="wb-c num">{b.nodes + b.strokes}</span>
          <span className="wb-w num">{ago(b.updatedAt)}</span>
        </Link>
      ))}
    </Pane>
  );
}
