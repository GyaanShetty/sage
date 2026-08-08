"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check, ChevronDown, Code2, ExternalLink, Loader2, Play, Save, Search, Sparkles, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "@/features/dashboard/command.css";
import "./code-lab.css";

/**
 * Solve the problem here, submit it there.
 *
 * Worth being straight about the boundary: SAGE cannot submit to LeetCode.
 * Submission needs your logged-in session cookie and a CSRF token, and
 * borrowing those would mean asking you to paste your credentials into a
 * third-party app — which is exactly the thing you should never do, and
 * against LeetCode's terms besides.
 *
 * What it can do is everything up to that point: the real statement, a proper
 * editor, running your code against your own test input on a sandboxed public
 * runner, and a coach that refuses to hand you the answer unless you
 * explicitly ask for it. Then one button copies the solution for pasting.
 */

const LANGS = [
  { key: "python3", label: "Python" },
  { key: "cpp", label: "C++" },
  { key: "java", label: "Java" },
  { key: "javascript", label: "JavaScript" },
  { key: "typescript", label: "TypeScript" },
  { key: "golang", label: "Go" },
  { key: "rust", label: "Rust" },
] as const;
type LangKey = (typeof LANGS)[number]["key"];

const LEVELS = [
  { key: "nudge", label: "NUDGE", hint: "One question. No technique named." },
  { key: "approach", label: "APPROACH", hint: "The technique and why. Still no code." },
  { key: "review", label: "REVIEW", hint: "What's wrong with what you wrote." },
  { key: "solution", label: "SOLUTION", hint: "The full answer." },
] as const;
type Level = (typeof LEVELS)[number]["key"];

interface Problem {
  title: string; titleSlug: string; difficulty: string; statement: string;
  hints: string[]; topics: string[]; snippets: Record<string, string>; link: string;
}
/** A search hit — enough to choose between, not the whole problem. */
interface Found {
  title: string; titleSlug: string; difficulty: string;
  acRate: number; paidOnly: boolean; frontendId: string;
}

interface RunResult {
  ok: boolean; stdout: string; stderr: string; code: number | null; error?: string; timedOut: boolean;
}
interface Coaching { response: string; code: string; complexity: string; level: Level }

const DIFFICULTY: Record<string, string> = { Easy: "d-easy", Medium: "d-med", Hard: "d-hard" };

export function CodeLab({ slug }: { slug?: string }) {
  const router = useRouter();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [lang, setLang] = useState<LangKey>("python3");
  const [code, setCode] = useState("");
  const [stdin, setStdin] = useState("");
  const [run, setRun] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [coachBusy, setCoachBusy] = useState<Level | null>(null);
  const [helpUsed, setHelpUsed] = useState<Level[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showStatement, setShowStatement] = useState(true);
  // ── the picker ──────────────────────────────────────────────────────────
  // Until now the lab only ever showed the daily challenge, which is a fine
  // default and a poor constraint: revision means solving the problem you are
  // stuck on, not the one the site chose this morning.
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [results, setResults] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  // Edited code must survive a language switch, so starter code is only
  // dropped in when nothing has been written for that language yet.
  const touched = useRef<Record<string, boolean>>({});

  /**
   * Search as he types, but not on every keystroke — a keystroke is not a
   * question, and LeetCode does not need to hear about each one.
   */
  useEffect(() => {
    if (!picking) return;
    if (!query.trim() && !difficulty) { setResults(null); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (difficulty) params.set("difficulty", difficulty);
      const j = await fetch(`/api/leetcode/search?${params}`).then((r) => r.json()).catch(() => null);
      setSearching(false);
      if (j?.ok) { setSearchErr(null); setResults(j.data.problems as Found[]); }
      else {
        // The detail is what LeetCode said. Ugly, and the only thing that makes
        // a schema change fixable by whoever reads it.
        setSearchErr([j?.error ?? "The search didn't come back.", j?.detail].filter(Boolean).join(" — "));
        setResults([]);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [query, difficulty, picking]);

  const open = (found: Found) => {
    if (found.paidOnly) return;
    setPicking(false);
    setResults(null);
    setQuery("");
    // Through the URL, so the problem he is on survives a refresh and can be
    // linked to from anywhere else in the app.
    router.push(`/code?slug=${encodeURIComponent(found.titleSlug)}`);
  };

  const load = useCallback(async () => {
    setLoadErr(null);
    const j = await fetch(`/api/leetcode/problem${slug ? `?slug=${slug}` : ""}`)
      .then((r) => r.json()).catch(() => null);
    if (!j?.ok) { setLoadErr(j?.error ?? "Couldn't load the problem."); return; }
    setProblem(j.data as Problem);
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  // Starter code, when the editor is empty for this language.
  useEffect(() => {
    if (!problem) return;
    if (touched.current[lang]) return;
    setCode(problem.snippets[lang] ?? "");
  }, [problem, lang]);

  const execute = async () => {
    setRunning(true); setRun(null);
    const j = await fetch("/api/code/run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang, source: code, stdin }),
    }).then((r) => r.json()).catch(() => null);
    setRunning(false);
    setRun(j?.ok ? (j.data as RunResult) : { ok: false, stdout: "", stderr: "", code: null, timedOut: false, error: j?.error ?? "The runner didn't answer." });
  };

  const askCoach = async (level: Level) => {
    if (!problem) return;
    setCoachBusy(level); setCoaching(null);
    const j = await fetch("/api/code/coach", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "coach", level,
        title: problem.title, statement: problem.statement,
        language: lang, code,
        runOutput: run ? `${run.stdout}\n${run.stderr}`.trim() : "",
      }),
    }).then((r) => r.json()).catch(() => null);
    setCoachBusy(null);
    if (j?.ok) {
      setCoaching(j.data as Coaching);
      setHelpUsed((h) => (h.includes(level) ? h : [...h, level]));
    } else {
      setCoaching({ response: j?.error ?? "Couldn't get help just now.", code: "", complexity: "", level });
    }
  };

  const save = async () => {
    if (!problem || !code.trim()) return;
    setSaved(true);
    await fetch("/api/code/coach", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save", slug: problem.titleSlug, title: problem.title,
        language: lang, code, ran: !!run?.ok, helpUsed,
      }),
    }).catch(() => {});
  };

  /**
   * Hand the solution to the push page.
   *
   * sessionStorage rather than a query string: a whole solution does not
   * belong in a URL, and this survives exactly one navigation, which is all it
   * needs to.
   */
  const sendToPush = () => {
    try {
      sessionStorage.setItem("sage:push-draft", JSON.stringify({
        title: problem?.title ?? "",
        url: problem?.link ?? "",
        code,
        language: lang,
      }));
    } catch {
      // Private mode, or a full quota. The push page still opens; he pastes.
    }
    router.push("/push");
  };

  const copy = async () => {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="cl-wrap">
      <div className="cc-head">
        <div className="sectitle" style={{ marginBottom: 0 }}>
          <span className="sn"><Code2 className="size-3.5" /></span>
          <h2>Code</h2><span className="line" />
          {problem && (
            <span className={cn("tag", DIFFICULTY[problem.difficulty])}>{problem.difficulty.toUpperCase()}</span>
          )}
        </div>
      </div>

      <div className="cl-pickbar">
        <button className="cl-pickbtn" onClick={() => setPicking((v) => !v)}>
          <Search className="size-3" /> {picking ? "CLOSE" : "PICK A PROBLEM"}
        </button>
        {slug && (
          <button className="cl-pickbtn" onClick={() => router.push("/code")}>
            TODAY&rsquo;S DAILY
          </button>
        )}
      </div>

      {picking && (
        <div className="cl-picker">
          <div className="cl-pickrow">
            <input
              className="cl-pickinput"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, number, or slug — 'two sum', '146', 'lru-cache'"
            />
            <select className="cl-pickinput cl-pickdiff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="">Any</option>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </div>

          {searching && <p className="cl-dim"><Loader2 className="inline size-3 animate-spin" /> searching…</p>}

          {searchErr && <div className="cl-err">{searchErr}</div>}

          {results && results.length === 0 && !searching && !searchErr && (
            <p className="cl-dim">Nothing matched. Try the number, or fewer words.</p>
          )}

          <div className="cl-results">
            {(results ?? []).map((r) => (
              <button
                key={r.titleSlug}
                className={cn("cl-result", r.paidOnly && "locked")}
                onClick={() => open(r)}
                disabled={r.paidOnly}
                title={r.paidOnly ? "Premium — the statement is not public" : "Open it"}
              >
                <span className="cl-rnum">{r.frontendId}</span>
                <span className="cl-rtitle">{r.title}</span>
                <span className={cn("tag", DIFFICULTY[r.difficulty])}>{r.difficulty.toUpperCase()}</span>
                <span className="cl-rrate">{r.acRate}%</span>
                {r.paidOnly && <span className="cl-rlock">PREMIUM</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {loadErr && <div className="cl-err">{loadErr}</div>}
      {!problem && !loadErr && <p className="cl-dim"><Loader2 className="inline size-3 animate-spin" /> fetching today&apos;s problem…</p>}

      {problem && (
        <>
          <div className="cl-head">
            <h3 className="cl-title">{problem.title}</h3>
            <div className="cl-topics">
              {problem.topics.slice(0, 4).map((t) => <span className="cl-topic" key={t}>{t}</span>)}
            </div>
            <a className="cl-link" href={problem.link} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3" /> LEETCODE
            </a>
          </div>

          <button className="cl-fold" onClick={() => setShowStatement((v) => !v)}>
            <ChevronDown className={cn("size-3.5 transition-transform", !showStatement && "-rotate-90")} />
            {showStatement ? "HIDE STATEMENT" : "SHOW STATEMENT"}
          </button>
          {showStatement && <pre className="cl-statement">{problem.statement}</pre>}

          <div className="cl-grid">
            <div className="cl-editorcol">
              <div className="cl-bar">
                <select
                  className="cl-lang"
                  value={lang}
                  onChange={(e) => setLang(e.target.value as LangKey)}
                >
                  {LANGS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
                <button className="cl-btn primary" onClick={execute} disabled={running || !code.trim()}>
                  {running ? <><Loader2 className="size-3 animate-spin" /> RUNNING</> : <><Play className="size-3" /> RUN</>}
                </button>
                <button className="cl-btn" onClick={copy} disabled={!code.trim()}>
                  {copied ? <><Check className="size-3" /> COPIED</> : "COPY"}
                </button>
                <button className="cl-btn" onClick={save} disabled={saved || !code.trim()}>
                  {saved ? <><Check className="size-3" /> SAVED</> : <><Save className="size-3" /> SAVE</>}
                </button>
                {/* Solving it and filing it are one thought; they should not be
                    two screens with a copy-paste in between. */}
                <button className="cl-btn" onClick={sendToPush} disabled={!code.trim()}>
                  <Upload className="size-3" /> PUSH
                </button>
              </div>

              <textarea
                className="cl-editor"
                value={code}
                onChange={(e) => { touched.current[lang] = true; setCode(e.target.value); setSaved(false); }}
                spellCheck={false}
                placeholder="Write your solution…"
                onKeyDown={(e) => {
                  // Tab inserts indentation instead of leaving the editor —
                  // the default focus behaviour is useless in a code box.
                  if (e.key !== "Tab") return;
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: a, selectionEnd: b } = el;
                  const next = `${code.slice(0, a)}    ${code.slice(b)}`;
                  setCode(next);
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 4; });
                }}
              />

              <details className="cl-stdin">
                <summary>TEST INPUT (stdin)</summary>
                <textarea
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  placeholder="Whatever your program reads from standard input."
                  rows={3}
                />
              </details>

              {run && (
                <div className={cn("cl-out", run.ok ? "ok" : "bad")}>
                  <span className="cl-outhead">
                    {run.error ? "RUNNER" : run.timedOut ? "TIMED OUT" : run.ok ? "EXIT 0" : `EXIT ${run.code ?? "?"}`}
                  </span>
                  {run.error && <pre>{run.error}</pre>}
                  {run.stdout && <pre>{run.stdout}</pre>}
                  {run.stderr && <pre className="cl-stderr">{run.stderr}</pre>}
                  {!run.error && !run.stdout && !run.stderr && <pre className="cl-dim">No output.</pre>}
                </div>
              )}
            </div>

            <div className="cl-coachcol">
              <span className="hud-label"><Sparkles className="inline size-3" /> STUCK?</span>
              <p className="cl-coachnote">
                SAGE will not solve it unless you ask for the solution outright — the tick is
                worthless if you did not get there.
              </p>
              <div className="cl-levels">
                {LEVELS.map((l) => (
                  <button
                    key={l.key}
                    className={cn("cl-level", helpUsed.includes(l.key) && "used", l.key === "solution" && "danger")}
                    title={l.hint}
                    onClick={() => void askCoach(l.key)}
                    disabled={!!coachBusy}
                  >
                    {coachBusy === l.key ? <Loader2 className="size-3 animate-spin" /> : l.label}
                  </button>
                ))}
              </div>

              {coaching && (
                <div className="cl-coaching">
                  <p className="cl-coachtext">{coaching.response}</p>
                  {coaching.complexity && <p className="cl-complexity">{coaching.complexity}</p>}
                  {coaching.code && (
                    <>
                      <pre className="cl-solution">{coaching.code}</pre>
                      <button
                        className="cl-btn"
                        onClick={() => { touched.current[lang] = true; setCode(coaching.code); }}
                      >
                        USE THIS
                      </button>
                    </>
                  )}
                </div>
              )}

              {problem.hints.length > 0 && (
                <details className="cl-hints">
                  <summary>LEETCODE&apos;S OWN HINTS ({problem.hints.length})</summary>
                  <ol>{problem.hints.map((h, i) => <li key={i}>{h}</li>)}</ol>
                </details>
              )}

              <p className="cl-submitnote">
                Submitting has to happen on LeetCode — that needs your logged-in session, and no
                app should ever ask you for it. Copy, paste, submit.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
