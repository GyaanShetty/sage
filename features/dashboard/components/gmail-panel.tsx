"use client";

/**
 * The inbox, as it actually arrives.
 *
 * The wall has carried an unread *count* for a long time, which is the least
 * useful form the information takes: "6 unread" tells you there is work and
 * nothing about whether any of it matters. This is the senders and the
 * subjects, which is what you were going to click through to see anyway.
 *
 * One panel per mailbox rather than one merged list. They were merged, which
 * is defensible as "is there mail" and wrong as a morning routine: Gyaan
 * clears Gmail and then clears Outlook, two steps, and a single sorted list
 * cannot be cleared in two passes. `account` picks which; `both` is still
 * there for anywhere that only wants the one pane.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { Pane, Empty } from "@/components/pane";
import { Mail } from "lucide-react";
import { useLive } from "@/lib/live";
import { shareJson } from "@/lib/share";
import { asArray } from "@/lib/as-array";
import { TZ } from "@/lib/config";

interface Msg { id?: string; from: string; subject: string; snippet?: string; date?: string; unread?: boolean }

/** "Jane Doe <j@x.com>" → "Jane Doe"; a bare address → the part before the @. */
function sender(from: string): string {
  const named = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named) return named[1].trim();
  return from.replace(/[<>]/g, "").split("@")[0] || from;
}

const hhmm = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
};

type Account = "gmail" | "outlook" | "both";

const SOURCE: Record<Exclude<Account, "both">, { url: string; title: string; connect: string; href: string }> = {
  gmail: {
    url: "/api/mail?view=unread",
    title: "Gmail",
    connect: "Gmail isn\u2019t connected",
    href: "/api/integrations/google",
  },
  outlook: {
    url: "/api/mail?view=unread&account=outlook",
    title: "Outlook",
    connect: "Outlook isn\u2019t connected",
    href: "/settings",
  },
};

export function GmailPanel({ n, account = "both" }: { n?: number; account?: Account }) {
  const [gmail, setGmail] = useState<Msg[] | null>(null);
  const [outlook, setOutlook] = useState<Msg[] | null>(null);
  const [gmailDown, setGmailDown] = useState(false);
  const [outlookDown, setOutlookDown] = useState(false);

  const wantG = account !== "outlook";
  const wantO = account !== "gmail";

  const pull = useCallback(async () => {
    const [g, o] = await Promise.allSettled([
      wantG ? shareJson<{ ok?: boolean; data?: { messages?: unknown } }>(SOURCE.gmail.url) : Promise.resolve(null),
      wantO ? shareJson<{ ok?: boolean; data?: { messages?: unknown } }>(SOURCE.outlook.url) : Promise.resolve(null),
    ]);
    if (wantG) {
      if (g.status === "fulfilled" && g.value?.ok) { setGmail(asArray<Msg>(g.value.data?.messages)); setGmailDown(false); }
      else setGmailDown(true);
    }
    // Outlook is frequently not connected, which is a configuration state
    // rather than a failure — it says so rather than reporting an error.
    if (wantO) {
      if (o.status === "fulfilled" && o.value?.ok) { setOutlook(asArray<Msg>(o.value.data?.messages)); setOutlookDown(false); }
      else setOutlookDown(true);
    }
  }, [wantG, wantO]);
  useLive(pull, { everyMs: 300_000 });

  const rows = [...(wantG ? gmail ?? [] : []), ...(wantO ? outlook ?? [] : [])]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 12);

  const total = rows.length;
  const loaded = (!wantG || gmail !== null || gmailDown) && (!wantO || outlook !== null || outlookDown);
  /* A single-mailbox pane is named for its mailbox; the merged one is just
     "Inbox", because that is the only honest name for two of them. */
  const title = account === "both" ? "Inbox" : SOURCE[account].title;
  const down = account === "outlook" ? outlookDown : gmailDown;
  const empty = account === "both" ? gmailDown : down;

  return (
    <Pane
      n={n}
      title={title}
      status={total ? `${total} unread` : empty ? "not connected" : "clear"}
      live={total > 0}
    >
      {!loaded && <div className="tile-wait">OPENING…</div>}

      {empty && rows.length === 0 && loaded && (
        <div className="empty-state">
          <Mail className="es-mark size-5" strokeWidth={1.5} />
          <div className="es-t">{account === "both" ? SOURCE.gmail.connect : SOURCE[account].connect}</div>
          <div className="es-d">
            <Link href={account === "both" ? SOURCE.gmail.href : SOURCE[account].href} className="live">
              Connect →
            </Link>
          </div>
        </div>
      )}

      {!empty && rows.length === 0 && loaded && (
        <Empty reason="Nothing unread. The inbox is clear." />
      )}

      {rows.map((m, i) => (
        <Link
          className="gm-row"
          key={m.id ?? `${i}`}
          href="/mail"
          /* The snippet moves to the tooltip. In a quarter-width panel it was
             a second line inside a row sized for one, which is what made the
             list collide with itself. */
          title={m.snippet ? `${m.subject}\n\n${m.snippet}` : m.subject}
        >
          <span className="gm-from">{sender(m.from)}</span>
          <span className="gm-main">
            <span className="gm-sub">{m.subject || "(no subject)"}</span>
          </span>
          <span className="gm-when num">{hhmm(m.date)}</span>
        </Link>
      ))}
    </Pane>
  );
}
