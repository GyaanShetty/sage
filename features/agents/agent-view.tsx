"use client";

import { useEffect, useRef, useState } from "react";
import { Search, BookOpen, Brain, FileText, Loader2 } from "lucide-react";
import "@/features/dashboard/command.css";

interface TraceStep { kind: "tool" | "result" | "think"; tool?: string; text: string }

const TOOL_LABEL: Record<string, string> = { web_search: "Searching the web", knowledge_search: "Reading your knowledge" };

function Icon({ s }: { s: TraceStep }) {
  if (s.kind === "think") return <Brain className="size-3.5" />;
  if (s.tool === "web_search") return <Search className="size-3.5" />;
  if (s.tool === "knowledge_search") return <BookOpen className="size-3.5" />;
  return <FileText className="size-3.5" />;
}

const SUGGEST = ["Best free vector databases in 2026, with tradeoffs", "Summarize what I know about SAGE's architecture", "Compare Gemini vs Claude for agent tool-use"];

export function AgentView() {
  const [task, setTask] = useState("");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [shown, setShown] = useState(0);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const run = async (t: string) => {
    const q = t.trim();
    if (!q || running) return;
    setRunning(true); setError(null); setTrace([]); setShown(0); setReport(null);
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: q }) });
      const j = await res.json();
      if (!j.ok) { setError(j.error ?? "Agent failed."); setRunning(false); return; }
      setTrace(j.data.trace ?? []);
      setReport(j.data.report ?? null);
    } catch {
      setError("Link error — try again.");
      setRunning(false);
    }
  };

  // Reveal the trace step-by-step for the "watch it work" feel.
  useEffect(() => {
    if (!trace.length || shown >= trace.length) { if (trace.length && shown >= trace.length) setRunning(false); return; }
    const t = setTimeout(() => setShown((s) => s + 1), 650);
    return () => clearTimeout(t);
  }, [trace, shown]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [shown, report]);

  return (
    <div className="agentview">
      <div className="section" style={{ maxWidth: 820, margin: "0 auto" }}>
        <div className="sectitle"><span className="sn">AGT</span><h2>Research Agent</h2><span className="line" /><span className="tag">PLANS · SEARCHES · REPORTS</span></div>

        <div className="holo-input" style={{ marginBottom: 8 }}>
          <input value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run(task)} placeholder="Give SAGE a research task…" />
          <button onClick={() => run(task)} disabled={running}>{running ? "WORKING…" : "DISPATCH"}</button>
        </div>
        {!trace.length && !running && (
          <div className="chips">{SUGGEST.map((s) => <button key={s} className="chip" onClick={() => { setTask(s); run(s); }}>{s}</button>)}</div>
        )}
        {error && <p className="lbl" style={{ color: "#e07070", marginTop: 10 }}>{error.toUpperCase()}</p>}

        {(running || trace.length > 0) && (
          <div className="agent-trace">
            {running && shown === 0 && trace.length === 0 && (
              <div className="atrace-step"><span className="ats-ic"><Loader2 className="size-3.5 animate-spin" /></span><span className="ats-tx">Thinking through the task…</span></div>
            )}
            {trace.slice(0, shown).map((s, i) => (
              <div className={`atrace-step ${s.kind}`} key={i}>
                <span className="ats-ic"><Icon s={s} /></span>
                <div>
                  <div className="ats-head">{s.kind === "think" ? "Reasoning" : s.kind === "tool" ? (TOOL_LABEL[s.tool ?? ""] ?? s.tool) : `Got ${s.text}`}</div>
                  {s.kind !== "result" && <div className="ats-tx">{s.text}</div>}
                </div>
              </div>
            ))}
            {shown < trace.length && <div className="atrace-step"><span className="ats-ic"><Loader2 className="size-3.5 animate-spin" /></span><span className="ats-tx">…</span></div>}
          </div>
        )}

        {report && shown >= trace.length && (
          <div className="agent-report">
            <div className="ar-head">REPORT</div>
            <div className="ar-body">{report}</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
