"use client";

/**
 * The inbox, as it actually arrives.
 *
 * The wall has carried an unread *count* for a long time, which is the least
 * useful form the information takes: "6 unread" tells you there is work and
 * nothing about whether any of it matters. This is the senders and the
 * subjects, which is what you were going to click through to see anyway.
 *
 * Both mailboxes, because "inbox clear" that means only one of them is the
 * panel telling a half-truth.
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

export function GmailPanel({ n }: { n?: number }) {
  const [gmail, setGmail] = useState<Msg[] | null>(null);
  const [outlook, setOutlook] = useState<Msg[] | null>(null);
  const [gmailDown, setGmailDown] = useState(false);

  const pull = useCallback(async () => {
    const [g, o] = await Promise.allSettled([
      shareJson<{ ok?: boolean; data?: { messages?: unknown } }>("/api/mail?view=unread"),
      shareJson<{ ok?: boolean; data?: { messages?: unknown } }>("/api/mail?view=unread&account=outlook"),
    ]);
    if (g.status === "fulfilled" && g.value?.ok) { setGmail(asArray<Msg>(g.value.data?.messages)); setGmailDown(false); }
    else setGmailDown(true);
    // Outlook is frequently not connected, which is a configuration state
    // rather than a failure — it simply contributes nothing when it is.
    if (o.status === "fulfilled" && o.value?.ok) setOutlook(asArray<Msg>(o.value.data?.messages));
  }, []);
  useLive(pull, { everyMs: 300_000 });

  const rows = [...(gmail ?? []), ...(outlook ?? [])]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 12);

  const total = (gmail?.length ?? 0) + (outlook?.length ?? 0);

  return (
    <Pane
      n={n}
      title="Inbox"
      status={total ? `${total} unread` : gmailDown ? "not connected" : "clear"}
      live={total > 0}
    >
      {gmail === null && outlook === null && !gmailDown && <div className="tile-wait">OPENING…</div>}

      {gmailDown && gmail === null && (
        <div className="empty-state">
          <Mail className="es-mark size-5" strokeWidth={1.5} />
          <div className="es-t">Gmail isn&rsquo;t connected</div>
          <div className="es-d"><Link href="/api/integrations/google" className="live">Connect Google →</Link></div>
        </div>
      )}

      {!gmailDown && rows.length === 0 && gmail !== null && (
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
