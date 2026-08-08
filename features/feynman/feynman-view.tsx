"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Plus, Loader2, Trash2, Check, ChevronDown, Archive, RotateCcw } from "lucide-react";
import { useVoice } from "@/features/voice/use-voice";
import "./feynman.css";

/**
 * Explain — the Feynman loop.
 *
 * Mark what you do not understand, and it comes back. When it does, you say it
 * out loud in your own words and get marked against the source you saved with
 * it. The grade is never the interesting part; `missed` and `wrong` are.
 */

interface Attempt { at: string; explanation: string; score: number; missed: string[]; wrong: string[]; probe: string }
interface Concept {
  id: string; title: string; source: string; sourceUrl?: string;
  attempts: Attempt[]; dueAt: string; reps: number; at: string; retiredAt?: string | null;
  standing?: string;
}

function scoreTone(score: number): string {
  return score >= 80 ? "good" : score >= 60 ? "ok" : "bad";
}

function dueLabel(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "due now";
  if (days === 1) return "back tomorrow";
  return `back in ${days} days`;
}

export function FeynmanView() {
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");
  const [recording, setRecording] = useState(false);
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState({ title: "", source: "", sourceUrl: "" });
  /** Separate from `error`, which belongs to whichever concept is open. */
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const recordingRef = useRef(false);

  const onTranscript = useCallback((chunk: string) => {
    setExplanation((prev) => (prev ? `${prev.trim()} ${chunk}` : chunk));
  }, []);
  const voice = useVoice({ onTranscript });

  useEffect(() => {
    if (recordingRef.current && !voice.listening) {
      const t = setTimeout(() => { if (recordingRef.current) voice.start(); }, 220);
      return () => clearTimeout(t);
    }
  }, [voice.listening, voice]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/feynman");
      const json = await res.json();
      if (json.ok) { setConcepts(json.data.concepts as Concept[]); setLoadErr(null); }
      // Without this the list stayed null and the page said "Loading…"
      // forever — a permanent spinner for a request that already came back
      // and failed.
      else { setConcepts([]); setLoadErr(json.error ?? "The list came back empty-handed."); }
    } catch {
      setConcepts([]);
      setLoadErr("Couldn't reach the list.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggleRecording() {
    if (recordingRef.current) { recordingRef.current = false; setRecording(false); voice.stop(); return; }
    recordingRef.current = true; setRecording(true); setError(null); voice.start();
  }

  async function submit(id: string) {
    if (recordingRef.current) toggleRecording();
    if (explanation.trim().length < 20) { setError("Too short to grade — explain it as if to someone who has not read it."); return; }
    setGrading(true); setError(null);
    try {
      const res = await fetch("/api/feynman", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, explanation }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error ?? "Couldn't grade that."); return; }
      setResult(json.data.attempt as Attempt);
      setExplanation("");
      await load();
    } catch { setError("Network dropped on the way there."); }
    finally { setGrading(false); }
  }

  async function add() {
    if (!draft.title.trim() || !draft.source.trim()) return;
    setAdding(true); setError(null);
    try {
      const res = await fetch("/api/feynman", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error ?? "Couldn't save that."); return; }
      setDraft({ title: "", source: "", sourceUrl: "" });
      await load();
    } catch { setError("Network dropped on the way there."); }
    finally { setAdding(false); }
  }

  async function retire(id: string, retired: boolean) {
    await fetch("/api/feynman", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, retired }),
    });
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/feynman?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  const live = (concepts ?? []).filter((c) => !c.retiredAt);
  const archived = (concepts ?? []).filter((c) => c.retiredAt);
  const due = live.filter((c) => new Date(c.dueAt).getTime() <= Date.now());
  const later = live.filter((c) => new Date(c.dueAt).getTime() > Date.now());

  function renderConcept(c: Concept, isDue: boolean) {
    const open = active === c.id;
    const last = c.attempts?.at(-1);
    return (
      <div key={c.id} className={`fy-item ${open ? "open" : ""}`}>
        <button
          type="button"
          className="fy-itemhead"
          onClick={() => { setActive(open ? null : c.id); setResult(null); setExplanation(""); setError(null); }}
        >
          <b>{c.title}</b>
          {last && <span className={`fy-score ${scoreTone(last.score)}`}>{last.score}%</span>}
          <i>{isDue ? "due now" : dueLabel(c.dueAt)}</i>
          <ChevronDown size={13} className="fy-chev" />
        </button>

        {open && (
          <div className="fy-panelbody">
            {c.standing && <p className="fy-standing">{c.standing}</p>}

            <p className="fy-prompt">
              Say it in your own words, as if to someone who has not read the source. No jargon you
              could not also unpack.
            </p>

            {last?.probe && !result && (
              <p className="fy-probe"><b>Last time&rsquo;s gap</b> {last.probe}</p>
            )}

            <textarea
              className="fy-text"
              rows={7}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Explain it…"
            />

            <div className="fy-actions">
              {voice.supported && (
                <button type="button" className={`fy-btn ${recording ? "rec" : ""}`} onClick={toggleRecording}>
                  {recording ? <><Square size={12} /> Stop <i className="fy-pulse" /></> : <><Mic size={12} /> Talk</>}
                </button>
              )}
              <button type="button" className="fy-btn go" onClick={() => void submit(c.id)} disabled={grading}>
                {grading ? <Loader2 size={12} className="fy-spin" /> : <Check size={12} />}
                {grading ? "Marking" : "Mark it"}
              </button>
              <button type="button" className="fy-btn" onClick={() => void retire(c.id, !c.retiredAt)}>
                {c.retiredAt ? <><RotateCcw size={12} /> Bring back</> : <><Archive size={12} /> Got it</>}
              </button>
              <button type="button" className="fy-btn danger" onClick={() => void remove(c.id)}>
                <Trash2 size={12} /> Delete
              </button>
            </div>

            {error && <p className="fy-error">{error}</p>}

            {result && (
              <div className="fy-result">
                <div className={`fy-bigscore ${scoreTone(result.score)}`}>{result.score}<span>%</span></div>
                {result.wrong.length > 0 && (
                  <div className="fy-block bad">
                    <b>Wrong against the source</b>
                    <ul>{result.wrong.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                )}
                {result.missed.length > 0 && (
                  <div className="fy-block">
                    <b>Left out</b>
                    <ul>{result.missed.map((m, i) => <li key={i}>{m}</li>)}</ul>
                  </div>
                )}
                {result.wrong.length === 0 && result.missed.length === 0 && (
                  <p className="fy-clean">Nothing wrong and nothing missing. That is the whole test.</p>
                )}
                <p className="fy-probe"><b>Next gap to close</b> {result.probe}</p>
                <p className="fy-foot">{dueLabel(c.dueAt)} · attempt {c.attempts?.length ?? 1}</p>
              </div>
            )}

            {!result && c.attempts?.length > 0 && (
              <p className="fy-foot">{c.attempts.length} attempt{c.attempts.length === 1 ? "" : "s"} · last {new Date(c.attempts.at(-1)!.at).toLocaleDateString("en-GB")}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fy-wrap">
      <header className="fy-head">
        <h1>Explain</h1>
        <p className="fy-intro">
          Flashcards test whether you recognise an answer. This tests whether you can produce one.
          Mark what you do not understand, paste the source it should be judged against, and it comes
          back until you can say it plainly.
        </p>
      </header>

      <section className="fy-panel">
        <div className="fy-panelhead"><h3>Due</h3><span className="fy-count">{due.length}</span></div>
        {due.length === 0
          ? <p className="fy-empty">Nothing owed. Add a concept below the next time something does not land.</p>
          : <div className="fy-list">{due.map((c) => renderConcept(c, true))}</div>}
      </section>

      {later.length > 0 && (
        <section className="fy-panel">
          <div className="fy-panelhead"><h3>Scheduled</h3><span className="fy-count">{later.length}</span></div>
          <div className="fy-list">{later.map((c) => renderConcept(c, false))}</div>
        </section>
      )}

      <section className="fy-panel">
        <div className="fy-panelhead"><h3>Mark something you don&rsquo;t understand</h3></div>
        <input
          className="fy-input"
          placeholder="What is it called? e.g. why HNSW beats a flat index"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <textarea
          className="fy-text"
          rows={5}
          placeholder="Paste the source it should be graded against — the passage, the lecture notes, the paper's section. Your explanation is marked against this and nothing else."
          value={draft.source}
          onChange={(e) => setDraft({ ...draft, source: e.target.value })}
        />
        <input
          className="fy-input"
          placeholder="Link, optional"
          value={draft.sourceUrl}
          onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
        />
        <div className="fy-actions">
          <button type="button" className="fy-btn go" onClick={() => void add()} disabled={adding || !draft.title.trim() || !draft.source.trim()}>
            {adding ? <Loader2 size={12} className="fy-spin" /> : <Plus size={12} />} Add
          </button>
        </div>
        <p className="fy-hint">
          It is graded only against what you paste. Nothing here checks the source is right — that
          part is still on you.
        </p>
      </section>

      {archived.length > 0 && (
        <section className="fy-panel">
          <button type="button" className="fy-panelhead as-button" onClick={() => setShowArchived((v) => !v)}>
            <h3>Got it</h3><span className="fy-count">{archived.length}</span>
            <ChevronDown size={13} className="fy-chev" />
          </button>
          {showArchived && <div className="fy-list">{archived.map((c) => renderConcept(c, false))}</div>}
        </section>
      )}

      {concepts === null && !loadErr && <p className="fy-empty">Loading…</p>}
      {loadErr && <p className="fy-error">{loadErr}</p>}
    </div>
  );
}
