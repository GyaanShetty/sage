"use client";

import { useState } from "react";
import { BookOpen, Check, Download, ExternalLink, Loader2, Search } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";

/**
 * arXiv, in the knowledge base.
 *
 * Searching the web for a technical question returns blog posts about papers.
 * This returns the papers — free, no key, no account. Saving one ingests the
 * whole PDF rather than the abstract, because an abstract in the knowledge
 * base only answers the questions the abstract already answered.
 */

interface Paper {
  id: string; title: string; authors: string[]; summary: string;
  published: string; categories: string[]; url: string;
}

const btn =
  "flex items-center gap-1.5 border border-border-glass px-3 py-1 text-xs text-muted transition-colors hover:border-border-glass-strong hover:text-foreground disabled:opacity-40";

export function Papers() {
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState(false);
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const search = async (sortRecent = recent) => {
    if (!q.trim() || busy) return;
    setBusy(true); setError(null);
    const j = await fetch(`/api/papers?q=${encodeURIComponent(q.trim())}&sort=${sortRecent ? "recent" : "relevance"}`)
      .then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (j?.ok) setPapers(j.data.papers);
    else { setPapers([]); setError(j?.error ?? "arXiv didn't answer."); }
  };

  const save = async (p: Paper) => {
    setSaving(p.id);
    const j = await fetch("/api/papers", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: p.id }),
    }).then((r) => r.json()).catch(() => null);
    setSaving(null);
    if (j?.ok) setSaved((s) => ({ ...s, [p.id]: "saved" }));
    else setError(j?.error ?? "That paper wouldn't save.");
  };

  return (
    <GlassPanel className="mt-4 p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><BookOpen className="size-3.5" /> Papers</p>
      <p className="mt-1 text-xs text-subtle">
        Search arXiv and keep what matters. Saving ingests the full PDF, so it becomes
        searchable and citable alongside everything else here.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="portfolio optimisation, attention mechanisms, au:Bengio…"
          className="min-w-0 flex-1 border border-border-glass bg-glass px-3 py-1.5 text-[13px] text-foreground outline-none focus:border-[var(--live-dim)]"
        />
        <button
          onClick={() => { const next = !recent; setRecent(next); if (papers) void search(next); }}
          className={cn(btn, recent && "border-[var(--live-dim)] !text-[var(--live)]")}
          title="Sort by newest instead of relevance"
        >
          NEWEST
        </button>
        <button onClick={() => void search()} disabled={busy || !q.trim()} className={btn}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />} Search
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-amber-300">{error}</p>}

      {papers && papers.length === 0 && !error && (
        <p className="mt-3 text-[11px] text-subtle">Nothing on arXiv for that.</p>
      )}

      {papers && papers.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {papers.map((p) => (
            <div key={p.id} className="border-l-2 border-border-glass pl-3">
              <div className="flex items-baseline gap-2">
                <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 text-[13px] leading-snug text-foreground hover:text-[var(--live)]">
                  {p.title}
                </a>
                <span className="shrink-0 font-mono text-[9px] text-subtle">{p.published.slice(0, 7)}</span>
              </div>

              <p className="mt-0.5 truncate text-[11px] text-subtle">
                {p.authors.slice(0, 4).join(", ")}{p.authors.length > 4 ? " et al." : ""}
                {p.categories[0] && <span className="ml-2 font-mono text-[9px]">{p.categories[0]}</span>}
              </p>

              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                {p.summary.slice(0, 320)}{p.summary.length > 320 ? "…" : ""}
              </p>

              <div className="mt-1.5 flex items-center gap-2">
                <button onClick={() => void save(p)} disabled={saving === p.id || !!saved[p.id]} className={btn}>
                  {saving === p.id ? <Loader2 className="size-3 animate-spin" />
                    : saved[p.id] ? <Check className="size-3" />
                    : <Download className="size-3" />}
                  {saved[p.id] ? "In knowledge" : "Save full text"}
                </button>
                <a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] text-subtle hover:text-foreground">
                  <ExternalLink className="size-3" /> arXiv:{p.id}
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
