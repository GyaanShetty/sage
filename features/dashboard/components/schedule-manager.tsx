"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, Calendar } from "lucide-react";
import type { EventRow } from "./command-view";
import { fmt } from "@/lib/config";
import { sound } from "@/lib/sound";

/** Add / remove Google Calendar events, shown in the Agenda magnify panel. */
export function ScheduleManager({ events }: { events: EventRow[] | null }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [local, setLocal] = useState<EventRow[]>(events ?? []);

  const add = async () => {
    if (!title.trim() || !when || busy) return;
    setBusy(true); setErr(null);
    // datetime-local is in the user's local wall time; send as ISO.
    const startIso = new Date(when).toISOString();
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: title.trim(), start: startIso }),
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) { setErr(j.error ?? "Could not add event"); return; }
    sound.blip();
    setLocal((l) => [...l, { id: j.data?.id, summary: title.trim(), start: startIso }].sort((a, b) => a.start.localeCompare(b.start)));
    setTitle(""); setWhen("");
    router.refresh();
  };

  const remove = async (id?: string) => {
    if (!id) return;
    setLocal((l) => l.filter((e) => e.id !== id));
    await fetch("/api/calendar", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    router.refresh();
  };

  return (
    <div className="tm-wrap">
      <div className="sm-add">
        <input className="sm-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title…" />
        <input className="sm-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <button onClick={add} disabled={busy} aria-label="Add event"><Plus className="size-4" /> ADD</button>
      </div>
      {err && <p className="lbl" style={{ color: "#e07070", marginBottom: 10 }}>{err.toUpperCase()}</p>}

      <div className="tm-list">
        {local.length === 0 && (
          <div className="empty-state" style={{ padding: "24px 0" }}>
            <Calendar className="es-mark size-5" strokeWidth={1.5} />
            <div className="es-t">No upcoming events</div>
            <div className="es-d">Add one above, or reconnect Google if adding fails.</div>
          </div>
        )}
        {local.map((e) => (
          <div className="tm-row" key={e.id ?? e.start + e.summary}>
            <span className="sm-date">
              {fmt(new Date(e.start), { weekday: "short", day: "2-digit", month: "short" }).toUpperCase()}
              {!e.allDay && ` · ${fmt(new Date(e.start), { hour: "2-digit", minute: "2-digit", hour12: false })}`}
            </span>
            <span className="tm-title">{e.summary}</span>
            {e.id && <button className="tm-ic danger" onClick={() => remove(e.id)} aria-label="Delete"><Trash2 className="size-3.5" /></button>}
          </div>
        ))}
      </div>
      <p className="lbl" style={{ marginTop: 14, opacity: 0.6 }}>WRITES TO YOUR GOOGLE CALENDAR · RECONNECT GOOGLE ONCE FOR EDIT ACCESS</p>
    </div>
  );
}
