"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { fmt } from "@/lib/config";
import { Acquiring } from "@/components/ui/acquiring";

interface Brief { id: string; createdAt: string; bucket: string | null; text: string }

/** Speak a script through the briefing player, which owns the caption strip. */
const speak = (text?: string) =>
  window.dispatchEvent(new CustomEvent("sage:replay-brief", { detail: text ? { text } : {} }));

/**
 * The debrief, made durable.
 *
 * SAGE has always written a briefing every morning, but it was spoken once and
 * then unreachable — if it played while you were away from the screen, or the
 * day's claim was spent by a tab you had closed, it was simply gone. This puts
 * the last fortnight in the rail: today's at the top, ready to replay, and the
 * earlier ones a tap away.
 */
export function BriefBlock() {
  const [items, setItems] = useState<Brief[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch("/api/brief/history?limit=14").then((r) => r.json()).catch(() => null);
    setItems(j?.ok ? (j.data as Brief[]) : []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Today's briefing — regenerated if the cache has rolled over to a new
   *  bucket, which is why this goes through the debrief endpoint rather than
   *  reading the top of the list. */
  const playToday = async () => {
    setBusy(true);
    speak();
    // Give the generator a beat, then refresh so a newly written script shows.
    setTimeout(() => { void load(); setBusy(false); }, 4000);
  };

  const latest = items?.[0] ?? null;
  const rest = items?.slice(1) ?? [];

  return (
    <div className="cell brief-cell">
      <div className="bh">
        <span className="t">Debrief</span>
        <span className="i">BRF</span>
        <span className="r">{items ? String(items.length).padStart(2, "0") : "··"}</span>
      </div>

      <button onClick={playToday} disabled={busy} className="brief-go">
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
        {busy ? "READING…" : "PLAY TODAY'S BRIEF"}
      </button>

      {items === null && <Acquiring label="BRIEF" />}
      {items?.length === 0 && <p className="brief-dim">No briefings recorded yet. The first one lands tomorrow morning.</p>}

      {latest && (
        <p className="brief-latest" title={latest.text}>{latest.text}</p>
      )}

      {rest.length > 0 && (
        <div className="brief-list">
          {rest.map((b) => {
            const open = openId === b.id;
            return (
              <div key={b.id} className={`brief-row${open ? " open" : ""}`}>
                <button className="brief-when" onClick={() => setOpenId(open ? null : b.id)}>
                  <span>{fmt(b.createdAt, { day: "2-digit", month: "short" }).toUpperCase()}</span>
                  <i>{b.bucket?.endsWith("PM") ? "PM" : "AM"}</i>
                </button>
                <button className="brief-play" onClick={() => speak(b.text)} title="Read this one aloud">
                  <RotateCcw className="size-3" />
                </button>
                {open && <p className="brief-full">{b.text}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
