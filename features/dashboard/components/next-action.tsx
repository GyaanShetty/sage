"use client";

import { useState } from "react";
import { Crosshair, Loader2, Split, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface NextPick { task: { id: string; title: string }; reason: string; minutes: number }
interface Subtask { title: string; minutes: number }

/**
 * The "what now" block — SAGE picks one task given the hour, the calendar and
 * last night's sleep, and can break a big one into steps. Dense by design: it
 * sits in the dashboard rail.
 */
export function NextAction() {
  const [pick, setPick] = useState<NextPick | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nl, setNl] = useState("");
  const [nlBusy, setNlBusy] = useState(false);
  const [nlDone, setNlDone] = useState<string | null>(null);

  const [subs, setSubs] = useState<Subtask[] | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [committed, setCommitted] = useState(false);

  const whatNow = async () => {
    setBusy(true); setPick(null); setEmpty(null); setSubs(null); setCommitted(false);
    const j = await fetch("/api/task/plan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "next" }),
    }).then((r) => r.json()).catch(() => null);
    if (j?.data?.empty) setEmpty(j.data.reason);
    else if (j?.ok) setPick(j.data);
    else setEmpty("Couldn't decide just now.");
    setBusy(false);
  };

  const breakdown = async () => {
    if (!pick) return;
    setSubBusy(true); setSubs(null); setCommitted(false);
    const j = await fetch("/api/task/plan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "breakdown", title: pick.task.title }),
    }).then((r) => r.json()).catch(() => null);
    setSubs(j?.ok ? j.data.subtasks : null);
    setSubBusy(false);
  };

  const commitSubs = async () => {
    if (!pick) return;
    setCommitted(true);
    await fetch("/api/task/plan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "breakdown", title: pick.task.title, commit: true }),
    }).catch(() => setCommitted(false));
  };

  const quickAdd = async () => {
    const text = nl.trim();
    if (!text) return;
    setNlBusy(true); setNlDone(null);
    const j = await fetch("/api/task/plan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "schedule", text, commit: true }),
    }).then((r) => r.json()).catch(() => null);
    setNlDone(j?.ok ? `${j.data.title} — ${j.data.interpretation}` : "Couldn't parse that.");
    setNl("");
    setNlBusy(false);
  };

  return (
    <div className="cell na-cell">
      <div className="bh"><span className="t">What now</span><span className="i">NXT</span></div>

      <div className="na-add">
        <input
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && quickAdd()}
          placeholder="remind me Thursday after gym…"
        />
        <button onClick={quickAdd} disabled={nlBusy || !nl.trim()} title="Add with natural-language timing">
          {nlBusy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
        </button>
      </div>
      {nlDone && <p className="na-done">{nlDone}</p>}

      <button onClick={whatNow} disabled={busy} className="na-go">
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Crosshair className="size-3" />}
        {busy ? "THINKING…" : "WHAT SHOULD I DO NOW?"}
      </button>

      {empty && <p className="na-dim">{empty}</p>}

      {pick && (
        <div className="na-pick">
          <span className="na-title">{pick.task.title}</span>
          <span className="na-reason">{pick.reason}</span>
          <div className="na-row">
            <span className="na-mins">{pick.minutes} min</span>
            <button onClick={breakdown} disabled={subBusy} className="na-mini">
              {subBusy ? <Loader2 className="size-3 animate-spin" /> : <Split className="size-3" />} Break down
            </button>
          </div>
        </div>
      )}

      {subs && (
        <div className="na-subs">
          {subs.map((s, i) => (
            <div key={i} className="na-sub"><i>{i + 1}</i><span>{s.title}</span><b>{s.minutes}m</b></div>
          ))}
          <button onClick={commitSubs} disabled={committed} className={cn("na-mini", committed && "done")}>
            {committed ? <><Check className="size-3" /> Added</> : <><Plus className="size-3" /> Add all as tasks</>}
          </button>
        </div>
      )}
    </div>
  );
}
