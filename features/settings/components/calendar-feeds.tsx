"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarPlus, Check, Loader2, Trash2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";

/**
 * Calendars SAGE reads but does not own.
 *
 * A timetable or fixture list is published as an .ics URL by whoever runs it,
 * and stays correct without anyone maintaining a copy. Subscribing here puts
 * those events in the agenda, the brief and — the useful part — the 15-minute
 * prep reminders, so a lecture nudges you like anything else in the calendar.
 */

interface Feed {
  id: string; url: string; label: string; enabled: boolean;
  lastError?: string | null;
}

const btn =
  "flex items-center gap-1.5 border border-border-glass px-3 py-1 text-xs text-muted transition-colors hover:border-border-glass-strong hover:text-foreground disabled:opacity-40";

export function CalendarFeeds() {
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/calendar/feeds").then((r) => r.json()).catch(() => null);
    setFeeds(j?.ok ? j.data.feeds : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!url.trim() || busy) return;
    setBusy(true); setNote(null);
    const j = await fetch("/api/calendar/feeds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url.trim(), label: label.trim() || undefined }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (j?.ok) {
      setFeeds(j.data.feeds); setUrl(""); setLabel("");
      setNote(`Subscribed — ${j.data.events} events in the next month.`);
    } else {
      setNote(j?.error ?? "Couldn't add that one.");
    }
  };

  const toggle = async (f: Feed) => {
    const j = await fetch("/api/calendar/feeds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: f.id, enabled: !f.enabled }),
    }).then((r) => r.json()).catch(() => null);
    if (j?.ok) setFeeds(j.data.feeds);
  };

  const remove = async (id: string) => {
    setFeeds((p) => p?.filter((f) => f.id !== id) ?? null);
    await fetch(`/api/calendar/feeds?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <GlassPanel className="mt-4 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CalendarPlus className="size-3.5" /> Subscribed calendars
      </p>
      <p className="mt-1 text-xs text-subtle">
        Any .ics or webcal link — your timetable, exam schedule, a fixture list. Read live, so
        a moved lecture moves here too, and each event gets the same 15-minute nudge as
        anything in your own calendar.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="https://…/timetable.ics"
          className="min-w-0 flex-1 border border-border-glass bg-glass px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-[var(--live-dim)]"
        />
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="Name (optional)"
          className="w-36 border border-border-glass bg-glass px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-[var(--live-dim)]"
        />
        <button onClick={() => void add()} disabled={busy || !url.trim()} className={btn}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <CalendarPlus className="size-3" />} Subscribe
        </button>
      </div>

      {note && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted"><Check className="size-3" /> {note}</p>}

      {feeds && feeds.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {feeds.map((f) => (
            <div key={f.id} className="flex items-center gap-3 border-b border-border-glass py-1.5 text-[12px] last:border-0">
              <button
                onClick={() => void toggle(f)}
                title={f.enabled ? "Reading this calendar" : "Ignored"}
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  f.lastError ? "bg-amber-400" : f.enabled ? "bg-[var(--live)]" : "bg-subtle opacity-40",
                )}
              />
              <span className={cn("min-w-0 flex-1 truncate", !f.enabled && "opacity-50")}>
                {f.label}
                {f.lastError && (
                  <em className="ml-2 not-italic text-[10px] text-amber-300">
                    <AlertTriangle className="inline size-2.5" /> unreadable
                  </em>
                )}
              </span>
              <span className="hidden max-w-[220px] truncate font-mono text-[9px] text-subtle sm:block">{f.url}</span>
              <button onClick={() => void remove(f.id)} className="text-subtle transition-colors hover:text-foreground" title="Remove">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {feeds && feeds.length === 0 && (
        <p className="mt-3 text-[11px] text-subtle">
          Nothing subscribed yet. Most timetables and fixture lists have a &ldquo;subscribe&rdquo;
          or &ldquo;iCal&rdquo; link — that URL is what goes here.
        </p>
      )}
    </GlassPanel>
  );
}
