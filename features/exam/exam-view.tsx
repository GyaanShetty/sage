"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Loader2, Trash2, Check, Eye, Sparkles, Mic, Square } from "lucide-react";
import { useVoice } from "@/features/voice/use-voice";
import "./exam.css";
import { TZ } from "@/lib/config";

/**
 * Exam mode — the countdown, and the questions the night shift set.
 *
 * The phase copy is the point of the countdown. A number of days left is
 * available on any calendar; what it is *for* is not.
 */

interface Exam { id: string; subject: string; at: string; syllabus: string; doneAt?: string | null }
interface Attempt { at: string; answer: string; awarded: number; outOf: number; earned: string[]; lost: string[]; comment: string }
interface Question {
  id: string; examId: string; question: string; answer: string; marks: number; topic: string;
  attemptedAt?: string | null; attempt?: Attempt | null;
}
interface TopicScore { topic: string; percent: number; attempts: number; marks: number }
interface Countdown { exam: Exam; days: number; hours: number; phase: string; headline: string; focus: string }

export function ExamView() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ subject: "", at: "", syllabus: "" });
  const [weakest, setWeakest] = useState<TopicScore[]>([]);
  // Which question is being answered, and what has been written so far. One at
  // a time on purpose: an exam is answered one question at a time.
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [marking, setMarking] = useState(false);
  const [recording, setRecording] = useState(false);

  const recordingRef = useRef(false);
  const voice = useVoice({
    onTranscript: (chunk) => setAnswer((prev) => (prev ? `${prev.trim()} ${chunk}` : chunk)),
  });

  useEffect(() => {
    if (recordingRef.current && !voice.listening) {
      const t = setTimeout(() => { if (recordingRef.current) voice.start(); }, 220);
      return () => clearTimeout(t);
    }
  }, [voice.listening, voice]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/exam");
      const json = await res.json();
      if (!json.ok) return;
      setExams(json.data.exams as Exam[]);
      setQuestions(json.data.questions as Question[]);
      setCountdown(json.data.countdown as Countdown | null);
      setWeakest((json.data.weakest ?? []) as TopicScore[]);
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

  function toggleRecording() {
    if (recordingRef.current) { recordingRef.current = false; setRecording(false); voice.stop(); return; }
    recordingRef.current = true; setRecording(true); voice.start();
  }

  function startAnswering(id: string) {
    if (recordingRef.current) toggleRecording();
    setAnswering(answering === id ? null : id);
    setAnswer("");
    setError(null);
  }

  async function mark(id: string) {
    if (recordingRef.current) toggleRecording();
    if (answer.trim().length < 5) { setError("Write something first — a blank is a zero either way."); return; }
    setMarking(true); setError(null);
    try {
      const res = await fetch("/api/exam", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, answer }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error ?? "Couldn't mark that."); return; }
      setAnswering(null);
      setAnswer("");
      setRevealed((p) => new Set([...p, id]));
      await load();
    } catch { setError("Network dropped on the way there."); }
    finally { setMarking(false); }
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
              timeZone: TZ, weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
            })}
          </p>
        </section>
      )}

      {weakest.length > 0 && (
        <section className="ex-panel">
          <div className="ex-panelhead">
            <h3>Where the marks are going</h3>
            <span className="ex-count-lbl">weakest first</span>
          </div>
          <div className="ex-topics">
            {weakest.map((t) => (
              <div key={t.topic} className="ex-topic-row">
                <span className="ex-tname">{t.topic}</span>
                <span className="ex-track"><i style={{ width: `${Math.max(2, t.percent)}%` }} className={t.percent >= 70 ? "good" : t.percent >= 45 ? "ok" : "bad"} /></span>
                <b>{t.percent}%</b>
                <i>{t.marks} marks · {t.attempts} {t.attempts === 1 ? "question" : "questions"}</i>
              </div>
            ))}
          </div>
          <p className="ex-hint">
            Tonight&rsquo;s questions lean toward whatever is at the top of this list. One question is
            not a weakness — the count is there so you can tell the difference.
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

                {q.attempt && (
                  <div className="ex-mark">
                    <div className={`ex-awarded ${q.attempt.awarded / q.attempt.outOf >= 0.7 ? "good" : q.attempt.awarded / q.attempt.outOf >= 0.4 ? "ok" : "bad"}`}>
                      {q.attempt.awarded}<span>/{q.attempt.outOf}</span>
                    </div>
                    {q.attempt.lost.length > 0 && (
                      <div className="ex-block bad">
                        <b>Marks lost</b>
                        <ul>{q.attempt.lost.map((l, i) => <li key={i}>{l}</li>)}</ul>
                      </div>
                    )}
                    {q.attempt.earned.length > 0 && (
                      <div className="ex-block">
                        <b>Credited</b>
                        <ul>{q.attempt.earned.map((l, i) => <li key={i}>{l}</li>)}</ul>
                      </div>
                    )}
                    <p className="ex-comment">{q.attempt.comment}</p>
                  </div>
                )}

                {answering === q.id ? (
                  <>
                    <textarea
                      className="ex-input ex-area"
                      rows={6}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Answer it as you would on the paper…"
                    />
                    <div className="ex-actions">
                      {voice.supported && (
                        <button type="button" className={`ex-btn ${recording ? "rec" : ""}`} onClick={toggleRecording}>
                          {recording ? <><Square size={12} /> Stop</> : <><Mic size={12} /> Talk</>}
                        </button>
                      )}
                      <button type="button" className="ex-btn go" onClick={() => void mark(q.id)} disabled={marking}>
                        {marking ? <Loader2 size={12} className="ex-spin" /> : <Check size={12} />}
                        {marking ? "Marking" : "Mark it"}
                      </button>
                      <button type="button" className="ex-btn" onClick={() => setAnswering(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <div className="ex-actions">
                    <button type="button" className="ex-btn go" onClick={() => startAnswering(q.id)}>
                      <Check size={12} /> {q.attempt ? "Answer again" : "Answer it"}
                    </button>
                    {!revealed.has(q.id) && (
                      <button type="button" className="ex-btn" onClick={() => reveal(q)}>
                        <Eye size={12} /> Show scheme
                      </button>
                    )}
                  </div>
                )}

                {revealed.has(q.id) && <div className="ex-answer"><b>Mark scheme</b>{q.answer}</div>}
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
              <span>{new Date(e.at).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short" })}</span>
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
