"use client";

/**
 * The inbox, as it actually arrives.
 *
 * The wall has carried an unread *count* for a long time, which is the least
 * useful form the information takes: "6 unread" tells you there is work and
 * nothing about whether any of it matters. This is the senders and the
 * subjects, which is what you were going to click through to see anyway.
 *
 * Gmail only.
 *
 * This used to read both mailboxes, and briefly had an Outlook twin beside
 * it. Outlook is out: the Azure app is registered single-tenant, so the call
 * cannot succeed from this account, and a pane that is structurally
 * incapable of returning anything is worse than no pane — it fails a request
 * every five minutes to go on saying "not connected". The integration itself
 * is untouched in settings and on the mail page; if the Azure registration
 * is ever switched to multi-tenant, this pane is three lines from reading it
 * again.
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
  const [down, setDown] = useState(false);

  const pull = useCallback(async () => {
    try {
      const j = await shareJson<{ ok?: boolean; data?: { messages?: unknown } }>("/api/mail?view=unread");
      if (j?.ok) { setGmail(asArray<Msg>(j.data?.messages)); setDown(false); }
      else setDown(true);
    } catch {
      setDown(true);
    }
  }, []);
  useLive(pull, { everyMs: 300_000 });

  const rows = (gmail ?? []).slice(0, 12);
  const loaded = gmail !== null || down;

  return (
    <Pane
      n={n}
      title="Gmail"
      status={rows.length ? `${rows.length} unread` : down ? "not connected" : "clear"}
      live={rows.length > 0}
    >
      {!loaded && <div className="tile-wait">OPENING…</div>}

      {down && gmail === null && (
        <div className="empty-state">
          <Mail className="es-mark size-5" strokeWidth={1.5} />
          <div className="es-t">Gmail isn&rsquo;t connected</div>
          <div className="es-d"><Link href="/api/integrations/google" className="live">Connect Google →</Link></div>
        </div>
      )}

      {!down && rows.length === 0 && loaded && (
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
