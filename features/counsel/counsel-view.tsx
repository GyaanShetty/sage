"use client";

import { useState } from "react";
import {
  AlertTriangle, FileSearch, Loader2, Play, Scale, Search, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "./counsel.css";

/**
 * Counsel — the two questions a chief of staff exists for.
 *
 * "What do I know about them?" and "what happens if I do this?" Both were
 * answerable from data SAGE already held, and neither had anywhere to be
 * asked: the first meant searching four pages by type when you wanted them by
 * *who*, and the second got generic advice from a generic assistant because
 * nothing knew his numbers.
 *
 * One page, two panels, because they are the same moment — the two minutes
 * before you walk into something.
 */

interface DossierEntry { source: string; title: string; detail?: string; at?: string; href?: string }
interface Dossier { subject: string; entries: DossierEntry[]; lastSeen: string | null; empty: boolean }

interface Simulation {
  question: string;
  reading: string;
  ifYouDo: { horizon: string; effect: string }[];
  ifYouDont: string[];
  hinges: string[];
  unknowns: string[];
  lean: string;
  grounded: string[];
}

const GROUNDED_LABEL: Record<string, string> = {
  budget: "your budget",
  commitments: "your calendar",
  goals: "what you've said you want",
  health: "your sleep",
  record: "your judgement record",
};

export function CounselView() {
  const [subject, setSubject] = useState("");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [looking, setLooking] = useState(false);

  const [question, setQuestion] = useState("");
  const [sim, setSim] = useState<Simulation | null>(null);
  const [thinking, setThinking] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const look = async () => {
    if (!subject.trim() || looking) return;
    setLooking(true); setDossier(null);
    const j = await fetch(`/api/dossier?q=${encodeURIComponent(subject.trim())}`)
      .then((r) => r.json()).catch(() => null);
    setLooking(false);
    if (j?.ok) setDossier(j.data as Dossier);
  };

  const play = async () => {
    if (!question.trim() || thinking) return;
    setThinking(true); setSim(null); setSimError(null);
    const j = await fetch("/api/simulate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: question.trim() }),
    }).then((r) => r.json()).catch(() => null);
    setThinking(false);
    if (j?.ok) setSim(j.data as Simulation);
    else setSimError(j?.error ?? "Couldn't play that out.");
  };

  return (
    <div className="co-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}>
          <span className="sn"><Scale className="size-3.5" /></span>
          <h2>Counsel</h2><span className="line" />
        </div>
      </div>

      {/* ── dossier ────────────────────────────────────────────────────── */}
      <div className="co-card">
        <div className="co-cardhead"><FileSearch className="size-3.5" /><h3>DOSSIER</h3>
          <span className="co-avg">what you already know</span>
        </div>
        <p className="co-intro">
          A person, a company, a topic. Every email, memory, note, application and
          decision that touches it — gathered, not summarised.
        </p>

        <div className="co-row">
          <input
            value={subject} onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void look()}
            placeholder="Goldman Sachs · Priya · the internship"
            className="co-input"
          />
          <button onClick={() => void look()} disabled={looking || !subject.trim()} className="cc-btn cc-scan">
            {looking ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />} Pull the file
          </button>
        </div>

        {dossier?.empty && <p className="co-dim">Nothing on file about that yet.</p>}

        {dossier && !dossier.empty && (
          <div className="co-entries">
            {dossier.entries.map((e, i) => (
              <a key={i} href={e.href ?? "#"} className="co-entry">
                <span className={cn("co-src", e.source)}>{e.source}</span>
                <span className="co-entrybody">
                  <b>{e.title}</b>
                  {e.detail && <i>{e.detail}</i>}
                </span>
                {e.at && (
                  <span className="co-when">
                    {new Date(e.at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                  </span>
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── simulation ─────────────────────────────────────────────────── */}
      <div className="co-card">
        <div className="co-cardhead"><Play className="size-3.5" /><h3>PLAY IT OUT</h3>
          <span className="co-avg">against your actual situation</span>
        </div>
        <p className="co-intro">
          Not general advice — worked against your money, your calendar, what you have
          said you want, and how your calls have actually gone.
        </p>

        <div className="co-row">
          <input
            value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void play()}
            placeholder="What if I take the Bangalore offer?"
            className="co-input"
          />
          <button onClick={() => void play()} disabled={thinking || !question.trim()} className="cc-btn cc-scan">
            {thinking ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Play it out
          </button>
        </div>

        {simError && <p className="co-err"><AlertTriangle className="inline size-3" /> {simError}</p>}

        {sim && (
          <div className="co-sim">
            <p className="co-reading">{sim.reading}</p>

            {sim.ifYouDo.length > 0 && (
              <>
                <span className="co-lbl">IF YOU DO</span>
                <div className="co-horizons">
                  {sim.ifYouDo.map((h, i) => (
                    <div key={i} className="co-horizon">
                      <span className="co-hz">{h.horizon}</span>
                      <span>{h.effect}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {sim.ifYouDont.length > 0 && (
              <>
                <span className="co-lbl">IF YOU DON&apos;T</span>
                <ul className="co-list">{sim.ifYouDont.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </>
            )}

            {sim.hinges.length > 0 && (
              <>
                <span className="co-lbl">IT TURNS ON</span>
                <ul className="co-list">{sim.hinges.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </>
            )}

            {/* What SAGE could not see matters as much as what it could. */}
            {sim.unknowns.length > 0 && (
              <>
                <span className="co-lbl">NOT KNOWN</span>
                <ul className="co-list co-unknown">{sim.unknowns.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </>
            )}

            <div className="co-lean"><b>My read:</b> {sim.lean}</div>

            <p className="co-grounded">
              {sim.grounded.length > 0
                ? `Worked against ${sim.grounded.map((g) => GROUNDED_LABEL[g] ?? g).join(", ")}.`
                : "Nothing on file to ground this in — treat it as general reasoning."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
