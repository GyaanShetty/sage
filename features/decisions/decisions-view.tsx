"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Brain, Check, ChevronDown, Loader2, Plus, Scale, Target, Trash2, TrendingDown, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "./decisions.css";

/**
 * The decision journal.
 *
 * The list is not the product — the calibration is. So the top of the page is
 * the scoreboard, the middle is anything owed a review, and the archive is
 * last: the order of a thing you are meant to learn from rather than browse.
 */

type Outcome = "right" | "wrong" | "mixed" | "too-early";

interface Decision {
  id: string; title: string; reasoning: string; expectation: string;
  confidence: number; domain: string; decidedAt: string; reviewAt: string;
  alternatives?: string | null;
  outcome?: Outcome | null; whatHappened?: string | null; lesson?: string | null; reviewedAt?: string | null;
}
interface Band { label: string; n: number; claimed: number; actual: number; gap: number }
interface Calibration {
  scored: number; pending: number; hitRate: number; meanConfidence: number;
  overconfidence: number; brier: number | null; bands: Band[];
  byDomain: { domain: string; n: number; hitRate: number; overconfidence: number }[];
  notes: string[];
}

const DOMAINS = ["markets", "career", "study", "health", "money", "life"];
const OUTCOMES: { key: Outcome; label: string }[] = [
  { key: "right", label: "Right" },
  { key: "wrong", label: "Wrong" },
  { key: "mixed", label: "Partly" },
  { key: "too-early", label: "Too early" },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });

/** Default review date: three months out, long enough for most calls to resolve. */
function defaultReview(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0, 10);
}

export function DecisionsView() {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [due, setDue] = useState<Decision[]>([]);
  const [cal, setCal] = useState<Calibration | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    title: "", reasoning: "", expectation: "", alternatives: "",
    confidence: 70, domain: "markets", reviewAt: defaultReview(),
  });
  const [review, setReview] = useState<{ id: string; outcome: Outcome; whatHappened: string; lesson: string } | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/decisions").then((r) => r.json()).catch(() => null);
    if (j?.ok) { setDecisions(j.data.decisions); setDue(j.data.due); setCal(j.data.calibration); }
    else setDecisions([]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const apply = (j: { ok?: boolean; data?: { decisions: Decision[]; due: Decision[]; calibration: Calibration } } | null) => {
    if (!j?.ok || !j.data) return false;
    setDecisions(j.data.decisions); setDue(j.data.due); setCal(j.data.calibration);
    return true;
  };

  const add = async () => {
    if (!draft.title.trim() || !draft.expectation.trim() || busy) return;
    setBusy(true);
    const j = await fetch("/api/decisions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draft, reviewAt: new Date(`${draft.reviewAt}T09:00:00`).toISOString() }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (apply(j)) {
      setDraft({ title: "", reasoning: "", expectation: "", alternatives: "", confidence: 70, domain: draft.domain, reviewAt: defaultReview() });
      setAdding(false);
    }
  };

  const submitReview = async () => {
    if (!review?.whatHappened.trim() || busy) return;
    setBusy(true);
    const j = await fetch("/api/decisions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(review),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (apply(j)) setReview(null);
  };

  const remove = async (id: string) => {
    setDecisions((p) => p?.filter((d) => d.id !== id) ?? null);
    await fetch(`/api/decisions?id=${id}`, { method: "DELETE" }).catch(() => {});
    void load();
  };

  const reviewed = decisions?.filter((d) => d.outcome) ?? [];
  const openCalls = decisions?.filter((d) => !d.outcome && !due.some((x) => x.id === d.id)) ?? [];

  return (
    <div className="dj-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}>
          <span className="sn"><Brain className="size-3.5" /></span>
          <h2>Decisions</h2><span className="line" />
          {cal && cal.scored > 0 && <span className="tag">{pct(cal.hitRate)} RIGHT · {cal.scored} SCORED</span>}
        </div>
        <button onClick={() => setAdding((s) => !s)} className="cc-btn cc-scan">
          <Plus className="size-3.5" /> Record a call
        </button>
      </div>

      <p className="dj-intro">
        Write down what you think will happen, and how sure you are, before you find out.
        Memory rewrites a 55% hunch into &ldquo;I knew it&rdquo; — this doesn&apos;t.
      </p>

      {/* ── new decision ───────────────────────────────────────────────── */}
      {adding && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="dj-form">
          <input
            value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="The call — 'going long on X', 'taking the Bangalore offer'"
            className="dj-input"
          />
          <textarea
            value={draft.reasoning} onChange={(e) => setDraft({ ...draft, reasoning: e.target.value })}
            placeholder="Why. Write it as you actually think it, not as you'd defend it later."
            rows={3} className="dj-input"
          />
          <textarea
            value={draft.expectation} onChange={(e) => setDraft({ ...draft, expectation: e.target.value })}
            placeholder="What should be true by the review date? Specific enough to be wrong."
            rows={2} className="dj-input"
          />
          <input
            value={draft.alternatives} onChange={(e) => setDraft({ ...draft, alternatives: e.target.value })}
            placeholder="What you considered instead (optional)"
            className="dj-input"
          />

          <div className="dj-formrow">
            <label className="dj-field">
              <span>Domain</span>
              <select value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })}>
                {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>

            <label className="dj-field dj-conf">
              <span>Confidence · <b>{draft.confidence}%</b></span>
              <input
                type="range" min={50} max={99} value={draft.confidence}
                onChange={(e) => setDraft({ ...draft, confidence: Number(e.target.value) })}
              />
            </label>

            <label className="dj-field">
              <span>Review on</span>
              <input type="date" value={draft.reviewAt} onChange={(e) => setDraft({ ...draft, reviewAt: e.target.value })} />
            </label>

            <button onClick={add} disabled={busy || !draft.title.trim() || !draft.expectation.trim()} className="cc-btn cc-scan">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Record
            </button>
          </div>
          <p className="dj-hint">
            Below 50% isn&apos;t a confidence, it&apos;s the opposite decision — so the slider starts there.
            You&apos;ll get a reminder on the review date.
          </p>
        </motion.div>
      )}

      {/* ── calibration ────────────────────────────────────────────────── */}
      {cal && (
        <div className="dj-card">
          <div className="dj-cardhead"><Target className="size-3.5" /><h3>CALIBRATION</h3>
            {cal.brier !== null && <span className="dj-avg" title="Mean squared error between confidence and outcome. 0 is perfect, 0.25 is a coin flip.">Brier {cal.brier.toFixed(3)}</span>}
          </div>

          {cal.scored > 0 && (
            <>
              <div className="dj-stats">
                <div className="dj-stat">
                  <b>{pct(cal.hitRate)}</b><span>actually right</span>
                </div>
                <div className="dj-stat">
                  <b>{pct(cal.meanConfidence)}</b><span>average claim</span>
                </div>
                <div className={cn("dj-stat", cal.overconfidence < -0.05 && "bad", cal.overconfidence > 0.05 && "warn")}>
                  <b>
                    {cal.overconfidence < 0 ? <TrendingDown className="inline size-4" /> : <TrendingUp className="inline size-4" />}
                    {" "}{Math.abs(Math.round(cal.overconfidence * 100))}
                  </b>
                  <span>{cal.overconfidence < 0 ? "overconfident" : "underconfident"}</span>
                </div>
              </div>

              {/* Claimed against actual, per confidence band. */}
              <div className="dj-bands">
                {cal.bands.map((b) => (
                  <div key={b.label} className={cn("dj-band", b.n === 0 && "empty")}>
                    <span className="dj-bandlbl">{b.label}</span>
                    <div className="dj-bandtrack">
                      <div className="dj-bandclaim" style={{ width: `${b.claimed * 100}%` }} title={`claimed ${pct(b.claimed)}`} />
                      {b.n > 0 && (
                        <div
                          className={cn("dj-bandactual", b.gap < -0.1 && "under")}
                          style={{ width: `${b.actual * 100}%` }}
                          title={`actually ${pct(b.actual)} across ${b.n}`}
                        />
                      )}
                    </div>
                    <span className="dj-bandn">{b.n || "—"}</span>
                  </div>
                ))}
              </div>
              <p className="dj-legend"><i className="claim" /> claimed <i className="actual" /> actual</p>
            </>
          )}

          {cal.notes.map((n, i) => <p key={i} className="dj-note">{n}</p>)}
        </div>
      )}

      {/* ── due for review ─────────────────────────────────────────────── */}
      {due.length > 0 && (
        <div className="dj-card dj-due">
          <div className="dj-cardhead"><Scale className="size-3.5" /><h3>OWED A VERDICT</h3><span className="dj-avg">{due.length}</span></div>
          {due.map((d) => (
            <div key={d.id} className="dj-duerow">
              <div className="dj-duetop">
                <span className="dj-duetitle">{d.title}</span>
                <span className="dj-duemeta">{d.confidence}% · {day(d.decidedAt)}</span>
              </div>
              <p className="dj-expect">You expected: {d.expectation}</p>

              {review?.id === d.id ? (
                <div className="dj-reviewform">
                  <div className="dj-outcomes">
                    {OUTCOMES.map((o) => (
                      <button
                        key={o.key}
                        onClick={() => setReview({ ...review, outcome: o.key })}
                        className={cn("dj-outcome", review.outcome === o.key && o.key)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={review.whatHappened}
                    onChange={(e) => setReview({ ...review, whatHappened: e.target.value })}
                    placeholder="What actually happened?" rows={2} className="dj-input"
                  />
                  <input
                    value={review.lesson}
                    onChange={(e) => setReview({ ...review, lesson: e.target.value })}
                    placeholder="What would you do differently? (optional)" className="dj-input"
                  />
                  <div className="dj-reviewactions">
                    <button onClick={submitReview} disabled={busy || !review.whatHappened.trim()} className="cc-btn cc-scan">
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Score it
                    </button>
                    <button onClick={() => setReview(null)} className="dj-cancel">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setReview({ id: d.id, outcome: "right", whatHappened: "", lesson: "" })}
                  className="dj-quickask"
                >
                  Score this one →
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── open calls ─────────────────────────────────────────────────── */}
      {openCalls.length > 0 && (
        <div className="dj-card">
          <div className="dj-cardhead"><Brain className="size-3.5" /><h3>OPEN</h3><span className="dj-avg">{openCalls.length}</span></div>
          {openCalls.map((d) => (
            <div key={d.id} className="dj-row">
              <span className="dj-conf-chip">{d.confidence}%</span>
              <span className="dj-rowtitle">{d.title}</span>
              <span className="dj-rowdomain">{d.domain}</span>
              <span className="dj-rowdate">reviews {day(d.reviewAt)}</span>
              <button onClick={() => void remove(d.id)} className="cc-del" title="Remove"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* ── the record ─────────────────────────────────────────────────── */}
      {reviewed.length > 0 && (
        <div className="dj-card">
          <div className="dj-cardhead"><Check className="size-3.5" /><h3>SCORED</h3><span className="dj-avg">{reviewed.length}</span></div>
          {reviewed.map((d) => (
            <div key={d.id} className="dj-scored">
              <button className="dj-row dj-rowbtn" onClick={() => setOpen(open === d.id ? null : d.id)}>
                <span className={cn("dj-verdict", d.outcome)}>{d.outcome}</span>
                <span className="dj-conf-chip">{d.confidence}%</span>
                <span className="dj-rowtitle">{d.title}</span>
                <span className="dj-rowdate">{day(d.decidedAt)}</span>
                <ChevronDown className={cn("size-3 shrink-0 transition-transform", open === d.id && "rotate-180")} />
              </button>
              {open === d.id && (
                <div className="dj-detail">
                  {d.reasoning && <p><b>Thinking then:</b> {d.reasoning}</p>}
                  <p><b>Expected:</b> {d.expectation}</p>
                  {d.alternatives && <p><b>Considered instead:</b> {d.alternatives}</p>}
                  {d.whatHappened && <p><b>Happened:</b> {d.whatHappened}</p>}
                  {d.lesson && <p className="dj-lesson"><b>Lesson:</b> {d.lesson}</p>}
                  <button onClick={() => void remove(d.id)} className="dj-cancel">Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {decisions?.length === 0 && !adding && (
        <p className="dj-empty">
          Nothing recorded yet. The next time you back a view — a trade, an offer, a bet on
          how something plays out — write it here first.
        </p>
      )}
    </div>
  );
}
