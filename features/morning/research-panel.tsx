"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, Loader2, Plus, Search, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ask SAGE to go and find out.
 *
 * The morning block reads what the world published; this is for the moment you
 * hit something you do not understand and want it chased down properly —
 * live sources, cited, and tied back to what you actually hold and are working
 * on. Follow-up questions are one click, because the second question is
 * usually the one worth asking.
 */

interface Brief {
  id: string;
  topic: string;
  headline: string;
  summary: string;
  keyPoints: string[];
  soWhat: string[];
  uncertainty: string;
  followUps: string[];
  actions: string[];
  sources: { title: string; url: string }[];
}

export function ResearchPanel({ seed }: { seed?: string[] }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const run = async (topic: string) => {
    if (!topic.trim() || busy) return;
    setBusy(true); setErr(null); setBrief(null); setQ(topic);
    const j = await fetch("/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic }),
    }).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (j?.ok) setBrief(j.data as Brief);
    else setErr(j?.error ?? "That didn't come back. Try again in a moment.");
  };

  const addTask = async (title: string) => {
    setSaved((s) => new Set(s).add(title));
    await fetch("/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  };

  return (
    <div className="mb-synsec">
      <span className="lbl !text-[9px]"><Search className="inline size-3" /> DIG INTO SOMETHING</span>

      <form
        onSubmit={(e) => { e.preventDefault(); void run(q); }}
        className="mt-2 flex items-center gap-2 border border-border-glass px-2"
      >
        <Search className="size-3.5 shrink-0 text-subtle" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask anything — SAGE reads live sources and cites them"
          className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none placeholder:text-subtle"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="shrink-0 py-2 text-[10px] uppercase tracking-wider text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Research"}
        </button>
      </form>

      {!brief && !busy && seed && seed.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {seed.slice(0, 4).map((s) => (
            <button
              key={s}
              onClick={() => void run(s)}
              className="max-w-full truncate border border-border-glass px-2 py-1 text-[11px] text-subtle transition-colors hover:border-border-glass-strong hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {busy && <p className="mt-2 text-xs text-subtle">Reading sources on “{q}”…</p>}
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      {brief && (
        <div className="mt-3 border-l border-border-glass pl-3">
          <p className="text-[13px] font-medium">{brief.headline}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">{brief.summary}</p>

          {brief.keyPoints.length > 0 && (
            <ul className="mb-synlist mt-2">
              {brief.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
            </ul>
          )}

          {brief.soWhat.length > 0 && (
            <div className="mt-3">
              <span className="lbl !text-[9px]"><TrendingUp className="inline size-3" /> WHAT IT MEANS FOR YOU</span>
              <ul className="mb-synlist mt-1">
                {brief.soWhat.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
              <div className="mt-1 flex gap-3 text-[10px] uppercase tracking-wider text-subtle">
                <Link href="/portfolio" className="hover:text-foreground">Portfolio →</Link>
                <Link href="/markets" className="hover:text-foreground">Markets →</Link>
              </div>
            </div>
          )}

          {brief.uncertainty && (
            <p className="mt-3 text-[11px] italic text-subtle">Caveat: {brief.uncertainty}</p>
          )}

          {brief.actions.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {brief.actions.map((a) => (
                <button
                  key={a}
                  onClick={() => void addTask(a)}
                  disabled={saved.has(a)}
                  className="mb-synact"
                >
                  {saved.has(a) ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} {a}
                </button>
              ))}
            </div>
          )}

          {brief.followUps.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {brief.followUps.map((f) => (
                <button
                  key={f}
                  onClick={() => void run(f)}
                  className={cn(
                    "max-w-full truncate border border-border-glass px-2 py-1 text-[11px] text-subtle",
                    "transition-colors hover:border-border-glass-strong hover:text-foreground",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          )}

          {brief.sources.length > 0 && (
            <div className="mt-3">
              <span className="lbl !text-[9px]">SOURCES</span>
              <div className="mt-1 flex flex-col gap-0.5">
                {brief.sources.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 truncate text-[11px] text-subtle transition-colors hover:text-foreground"
                  >
                    <ExternalLink className="size-3 shrink-0" /> <span className="truncate">{s.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
