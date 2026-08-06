"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, Trash2, Check, Eye, Sparkles } from "lucide-react";
import "./exam.css";

/**
 * Exam mode — the countdown, and the questions the night shift set.
 *
 * The phase copy is the point of the countdown. A number of days left is
 * available on any calendar; what it is *for* is not.
 */

interface Exam { id: string; subject: string; at: string; syllabus: string; doneAt?: string | null }
interface Question { id: string; examId: string; question: string; answer: string; marks: number; topic: string; attemptedAt?: string | null }
interface Countdown { exam: Exam; days: number; hours: number; phase: string; headline: string; focus: string }

export function ExamView() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ subject: "", at: "", syllabus: "" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/exam");
      const json = await res.json();
      if (!json.ok) return;
      setExams(json.data.exams as Exam[]);
      setQuestions(json.data.questions as Question[]);
      setCountdown(json.data.countdown as Countdown | null);
    } catch { setError("Couldn't reach the papers."); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function post(body: unknown) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/exam", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "That didn't work.");
      await load();
      return json.ok as boolean;
    } catch { setError("Network dropped on the way there."); return false; }
    finally { setBusy(false); }
  }

  async function add() {
    if (!draft.subject.trim() || !draft.at) return;
    const ok = await post({ ...draft, at: new Date(draft.at).toISOString() });
    if (ok) setDraft({ subject: "", at: "", syllabus: "" });
  }

  async function remove(id: string) {
    await fetch(`/api/exam?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  function reveal(q: Question) {
    setRevealed((p) => new Set([...p, q.id]));
    if (!q.attemptedAt) void post({ id: q.id, attempted: true });
  }

  const unattempted = questions.filter((q) => !q.attemptedAt);

  return (
    <div className="ex-wrap">
      <header className="ex-head">
        <h1>Exams</h1>
        <p className="ex-intro">
          Put the date in and SAGE changes what it does about it: the night shift stops researching
          whatever you last wondered about and starts setting questions off your syllabus instead.
        </p>
      </header>

      {countdown && (
        <section className={`ex-count ph-${countdown.phase}`}>
          <div className="ex-num">
            <b>{Math.max(0, countdown.days)}</b>
            <span>{countdown.days === 1 ? "day" : "days"} to {countdown.exam.subject}</span>
          </div>
          <p className="ex-headline">{countdown.headline}</p>
          <p className="ex-focus">{countdown.focus}</p>
          <p className="ex-when">
            {new Date(countdown.exam.at).toLocaleString("en-GB", {
              timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
            })}
          </p>
        </section>
      )}

      {/* ── the questions ─────────────────────────────────────────── */}
      {countdown && (
        <section className="ex-panel">
          <div className="ex-panelhead">
            <h3>Practice</h3>
            <span className="ex-count-lbl">{unattempted.length} unattempted of {questions.length}</span>
          </div>

          {questions.length === 0 && (
            <p className="ex-empty">
              None set yet. The night shift will set five tonight, or ask for a set now.
            </p>
          )}

          <div className="ex-qlist">
            {questions.map((q) => (
              <div key={q.id} className={`ex-q ${q.attemptedAt ? "done" : ""}`}>
                <div className="ex-qhead">
                  <span className="ex-topic">{q.topic || "general"}</span>
                  <span className="ex-marks">{q.marks} marks</span>
                </div>
                <p className="ex-qtext">{q.question}</p>
                {revealed.has(q.id) ? (
                  <div className="ex-answer"><b>Mark scheme</b>{q.answer}</div>
                ) : (
                  <button type="button" className="ex-btn" onClick={() => reveal(q)}>
                    <Eye size={12} /> {q.attemptedAt ? "Show scheme" : "I've had a go — show the scheme"}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="ex-actions">
            <button type="button" className="ex-btn go" onClick={() => void post({ id: countdown.exam.id, generate: true })} disabled={busy}>
              {busy ? <Loader2 size={12} className="ex-spin" /> : <Sparkles size={12} />} Set five more
            </button>
          </div>
        </section>
      )}

      {/* ── papers ────────────────────────────────────────────────── */}
      <section className="ex-panel">
        <div className="ex-panelhead"><h3>Papers</h3></div>

        {exams.length === 0 && <p className="ex-empty">Nothing scheduled.</p>}

        <div className="ex-list">
          {exams.map((e) => (
            <div key={e.id} className={`ex-row ${e.doneAt ? "done" : ""}`}>
              <b>{e.subject}</b>
              <span>{new Date(e.at).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}</span>
              <button type="button" onClick={() => void post({ id: e.id, done: !e.doneAt })} title={e.doneAt ? "Not done after all" : "Sat it"}>
                <Check size={13} />
              </button>
              <button type="button" onClick={() => void remove(e.id)} title="Delete"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>

        <input className="ex-input" placeholder="Subject" value={draft.subject} onChange={(ev) => setDraft({ ...draft, subject: ev.target.value })} />
        <input className="ex-input" type="datetime-local" value={draft.at} onChange={(ev) => setDraft({ ...draft, at: ev.target.value })} />
        <textarea
          className="ex-input ex-area"
          rows={5}
          placeholder="Syllabus — units, topics, whatever the department actually published. Questions are generated only from this, so the more precise it is, the less the questions drift off-paper."
          value={draft.syllabus}
          onChange={(ev) => setDraft({ ...draft, syllabus: ev.target.value })}
        />
        <div className="ex-actions">
          <button type="button" className="ex-btn go" onClick={() => void add()} disabled={busy || !draft.subject.trim() || !draft.at}>
            <Plus size={12} /> Add paper
          </button>
        </div>

        {error && <p className="ex-error">{error}</p>}
        <p className="ex-hint">
          Nothing here hides pages or locks anything down. It changes what SAGE does overnight, and
          what it puts in front of you first — the rest of the app is still yours.
        </p>
      </section>
    </div>
  );
}
