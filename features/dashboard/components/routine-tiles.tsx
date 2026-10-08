"use client";

/**
 * The parts of Gyaan's day that had no pane.
 *
 * He listed fourteen things he does daily and the wall carried about half of
 * them. Most of the rest already existed as tiles elsewhere in the tree and
 * only needed placing. These two did not exist at all: what he is paying for
 * every month, and the whiteboard he calls his main workspace.
 */

import { useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { Pane, Empty } from "@/components/pane";
import { useLive } from "@/lib/live";
import { sound } from "@/lib/sound";
import { Check } from "lucide-react";
import { asArray } from "@/lib/as-array";
import { shareJson } from "@/lib/share";
/* The dashboard's own row type, imported rather than redeclared: two
   structurally identical interfaces drift the first time one gains a field.
   Type-only, so the cycle with command-view is erased at compile time —
   the same arrangement task-manager already uses. */
import type { TaskRow } from "./command-view";

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

/* ── directives ────────────────────────────────────────────────────────────
 *
 * What took Outlook's place.
 *
 * Outlook was on the wall because the routine names it, but the connection
 * never worked — the Azure app is single-tenant, so the pane could only ever
 * say "not connected" and make a failing request every five minutes. A pane
 * that is structurally incapable of showing anything is worse than no pane:
 * it occupies the position where something true could be.
 *
 * A tall narrow column beside the mail, the wire and the calendar is the
 * shape of a list, and the list that belongs in the morning is the one of
 * what he actually has to do. It reads the tasks the dashboard already
 * loaded rather than fetching again, ticks off in place, and takes a new one
 * without opening the modal — the modal is still there for editing and
 * deleting, which are rare, while adding and ticking are constant.
 */
export function DirectivesPanel({
  n, tasks, setTasks, onManage,
}: {
  n?: number;
  tasks: TaskRow[];
  setTasks: Dispatch<SetStateAction<TaskRow[]>>;
  onManage?: () => void;
}) {
  const [draft, setDraft] = useState("");

  const open = tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.dueAt && Date.parse(t.dueAt) < Date.now()).length;

  /* Overdue first, then the rest in the order they arrived. The question in
     the morning is what is late, and it is the only ordering that answers it
     without reading dates. */
  const rows = [...open].sort((a, b) => {
    const la = a.dueAt && Date.parse(a.dueAt) < Date.now() ? 0 : 1;
    const lb = b.dueAt && Date.parse(b.dueAt) < Date.now() ? 0 : 1;
    return la - lb;
  });

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const res = await fetch("/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const { data } = await res.json().catch(() => ({ data: null }));
    if (data?.id) {
      sound.blip();
      setTasks((prev) => [{ id: data.id, title, status: "todo", dueAt: null }, ...prev]);
    }
  };

  const toggle = async (t: TaskRow) => {
    sound.blip();
    /* Optimistic, then written. A tick that waits for the network feels
       broken at the exact moment the interface should feel fastest. */
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: "done" } : x)));
    await fetch(`/api/task/${t.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    }).catch(() => {
      // Put it back rather than lie about it having been saved.
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
    });
  };

  return (
    <Pane
      n={n}
      title="Directives"
      status={open.length ? `${open.length} open${overdue ? ` · ${overdue} late` : ""}` : "clear"}
      live={overdue > 0}
      alert={overdue > 0 ? "signal" : undefined}
    >
      <div className="dv-add">
        <input
          className="dv-in"
          value={draft}
          placeholder="Add a directive…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          aria-label="Add a directive"
        />
        <button className="dv-plus" onClick={() => void add()} aria-label="Add">+</button>
      </div>

      {rows.length === 0 && <Empty reason="Nothing open. The day is yours." />}

      {rows.slice(0, 10).map((t) => {
        const late = !!t.dueAt && Date.parse(t.dueAt) < Date.now();
        return (
          <div className={`dv-row${late ? " late" : ""}`} key={t.id}>
            <button className="dv-tick" onClick={() => void toggle(t)} aria-label={`Done: ${t.title}`}>
              <Check className="size-3" />
            </button>
            <span className="dv-t">{t.title}</span>
            {late && <span className="dv-late">LATE</span>}
          </div>
        );
      })}

      {onManage && open.length > 10 && (
        <button className="dv-more" onClick={onManage}>
          {open.length - 10} more · manage →
        </button>
      )}
    </Pane>
  );
}
