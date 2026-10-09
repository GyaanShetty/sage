"use client";

/**
 * The parts of Gyaan's day that had no pane.
 *
 * He listed fourteen things he does daily and the wall carried about half of
 * them. Most of the rest already existed as tiles elsewhere in the tree and
 * only needed placing. These two did not exist at all: what he is paying for
 * every month, and the whiteboard he calls his main workspace.
 */

import { useState, useCallback, type Dispatch, type SetStateAction } from "react";
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

/* ── expenses ──────────────────────────────────────────────────────────────
 *
 * Logging a spend without leaving the wall.
 *
 * This replaced the subscriptions pane, which was the right idea and the
 * wrong pane: it could only show what the receipt scanner had already found,
 * so on an account with nothing scanned it was a permanently empty box. The
 * thing he actually does several times a day is record that he spent
 * something, and that required opening the portfolio page.
 *
 * The form is inline and always visible rather than behind the pane's `+`.
 * A modal is correct for editing — rare, needs room — and wrong for an entry
 * you make while standing in a shop: three fields and a key press.
 *
 * Recurring charges have not gone anywhere; they are the "of which N
 * recurring" line, which is the form the information was actually useful in.
 */
interface Spend {
  total: number;
  byCategory: Record<string, number>;
  recurring: { merchant: string; amount: number }[];
}
interface Row { id: string; amount: number; merchant: string; category: string; date: string }

const CATS = ["food", "transport", "shopping", "bills", "subscriptions", "entertainment", "health", "other"];

export function ExpenseTile({ n }: { n?: number }) {
  const [sum, setSum] = useState<Spend | null | undefined>(undefined);
  const [recent, setRecent] = useState<Row[]>([]);
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [cat, setCat] = useState("food");
  const [busy, setBusy] = useState(false);

  /*
   * `fresh` matters, and the absence of it was a real bug.
   *
   * shareJson holds a resolved response for ten seconds so a dozen panels
   * mounting in one tick make one request. That is right for reads and wrong
   * immediately after a write: logging an expense and then re-reading inside
   * the window returns the response from BEFORE the write, so the row he just
   * added does not appear and the total does not move. It looks like the save
   * failed. Passing 0 as the freshness window opts this one call out.
   */
  const pull = useCallback(
    (fresh = false) => shareJson<{ data?: { summary?: Spend; expenses?: unknown } }>(
      "/api/expenses", fresh ? 0 : undefined,
    )
      .then((j) => {
        setSum(j?.data?.summary ?? null);
        setRecent(asArray<Row>(j?.data?.expenses).slice(0, 6));
      })
      .catch(() => setSum(null)),
    [],
  );
  useLive(() => pull(), { everyMs: 600_000 });

  const save = async () => {
    const amt = Number(amount);
    /* A number field must post a number — `amount: "250"` against a
       z.number() schema is a 400 that reads as "the form is broken". */
    if (!Number.isFinite(amt) || amt <= 0 || !merchant.trim() || busy) return;
    setBusy(true);
    try {
      await fetch("/api/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: amt, merchant: merchant.trim(), category: cat }),
      });
      sound.blip();
      setAmount(""); setMerchant("");
      await pull(true);
    } finally {
      setBusy(false);
    }
  };

  const subs = sum?.recurring ?? [];
  const subTotal = subs.reduce((a, x) => a + x.amount, 0);

  return (
    <Pane
      n={n}
      title="Expenses"
      status={sum?.total ? `${rupees(sum.total)} · 30d` : "nothing logged"}
      live={!!sum?.total}
    >
      <div className="xp-form">
        <input
          className="xp-amt num" inputMode="decimal" value={amount} placeholder="₹"
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          aria-label="Amount in rupees"
        />
        <input
          className="xp-who" value={merchant} placeholder="Where…"
          onChange={(e) => setMerchant(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          aria-label="Merchant"
        />
        <select className="xp-cat" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="xp-go" onClick={() => void save()} disabled={busy} aria-label="Log this expense">
          {busy ? "…" : "LOG"}
        </button>
      </div>

      {sum === undefined && <div className="tile-wait">READING…</div>}

      {sum && sum.total > 0 && (
        <div className="xp-sum">
          <span className="xp-tot num">{rupees(sum.total)}</span>
          <span className="xp-k">
            LAST 30 DAYS{subs.length ? ` · ${rupees(subTotal)} RECURRING` : ""}
          </span>
        </div>
      )}

      {recent.map((r) => (
        <div className="xp-row" key={r.id}>
          <span className="xp-m">{r.merchant}</span>
          <span className="xp-c">{r.category}</span>
          <span className="xp-a num">{rupees(r.amount)}</span>
        </div>
      ))}

      {sum !== undefined && recent.length === 0 && (
        <Empty reason="Nothing logged yet — the form above is the whole flow" />
      )}
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
