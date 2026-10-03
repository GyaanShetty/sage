"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen, Check, ExternalLink, HelpCircle, Lightbulb, Link2, Loader2, Timer, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/config";

/**
 * The trail behind a skill.
 *
 * A level says where you are. It says nothing about how you got there, and it
 * hides the most useful thing of all — what you still do not understand. Open
 * questions are shown first for exactly that reason.
 */

type Kind = "session" | "note" | "resource" | "question" | "insight";

interface Entry {
  id: string; skillId: string; kind: Kind; text: string;
  url?: string; minutes?: number; tags: string[]; at: string; resolvedAt?: string;
}
interface Stats {
  entries: number; minutes: number; sessions: number;
  openQuestions: Entry[]; resources: Entry[];
  recent: { day: string; minutes: number }[];
  lastStudiedAt: string | null;
}

const KINDS: { key: Kind; label: string; icon: typeof BookOpen }[] = [
  { key: "session", label: "SESSION", icon: Timer },
  { key: "note", label: "NOTE", icon: BookOpen },
  { key: "resource", label: "LINK", icon: Link2 },
  { key: "question", label: "QUESTION", icon: HelpCircle },
  { key: "insight", label: "INSIGHT", icon: Lightbulb },
];

const ICON: Record<Kind, typeof BookOpen> = {
  session: Timer, note: BookOpen, resource: Link2, question: HelpCircle, insight: Lightbulb,
};

export function StudyLog({ skillId, skillName }: { skillId: string; skillName: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [kind, setKind] = useState<Kind>("note");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [minutes, setMinutes] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch(`/api/education/log?skillId=${encodeURIComponent(skillId)}`)
      .then((r) => r.json()).catch(() => null);
    if (j?.ok) { setEntries(j.data.entries as Entry[]); setStats(j.data.stats as Stats); }
    else { setEntries([]); setStats(null); }
  }, [skillId]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    await fetch("/api/education/log", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        skillId, kind, text,
        url: url.trim() || undefined,
        minutes: Number(minutes) || undefined,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    }).catch(() => null);
    setBusy(false);
    setText(""); setUrl(""); setMinutes(""); setTags("");
    await load();
  };

  const remove = async (id: string) => {
    setEntries((e) => e?.filter((x) => x.id !== id) ?? null);
    await fetch(`/api/education/log?id=${id}`, { method: "DELETE" }).catch(() => null);
    await load();
  };

  const resolve = async (id: string) => {
    await fetch("/api/education/log", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resolve", id }),
    }).catch(() => null);
    await load();
  };

  const peak = Math.max(1, ...(stats?.recent ?? []).map((r) => r.minutes));

  return (
    <div className="sl-wrap">
      <div className="sl-head">
        <span className="lbl !text-[9px]">STUDY LOG · {skillName.toUpperCase()}</span>
        {stats && stats.entries > 0 && (
          <span className="sl-stat">
            {Math.round(stats.minutes / 60)}h across {stats.sessions} session{stats.sessions === 1 ? "" : "s"}
            {stats.openQuestions.length > 0 && ` · ${stats.openQuestions.length} open question${stats.openQuestions.length === 1 ? "" : "s"}`}
          </span>
        )}
      </div>

      {stats && stats.recent.some((r) => r.minutes > 0) && (
        <div className="sl-spark" title="Study minutes, last 14 days">
          {stats.recent.map((r) => (
            <i key={r.day} style={{ height: `${Math.max(3, (r.minutes / peak) * 100)}%` }} title={`${r.day}: ${r.minutes} min`} />
          ))}
        </div>
      )}

      {/* Open questions first — the honest record of what is still unclear. */}
      {stats && stats.openQuestions.length > 0 && (
        <div className="sl-open">
          <span className="lbl !text-[9px]">STILL UNANSWERED</span>
          {stats.openQuestions.map((q) => (
            <div className="sl-openrow" key={q.id}>
              <span>{q.text}</span>
              <button onClick={() => void resolve(q.id)} title="I understand this now">
                <Check className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="sl-form">
        <div className="sl-kinds">
          {KINDS.map((k) => (
            <button key={k.key} className={cn("sl-kind", kind === k.key && "on")} onClick={() => setKind(k.key)}>
              <k.icon className="size-3" /> {k.label}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            kind === "session" ? "What did you cover?"
            : kind === "question" ? "What did not make sense?"
            : kind === "resource" ? "What is this, and why keep it?"
            : kind === "insight" ? "What finally clicked?"
            : "Worth writing down…"
          }
          rows={2}
        />
        <div className="sl-row">
          {(kind === "resource" || kind === "note" || kind === "insight") && (
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (optional)" />
          )}
          {kind === "session" && (
            <input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ""))} placeholder="minutes" className="sl-mins" />
          )}
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" />
          <button className="sl-add" onClick={add} disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : "ADD"}
          </button>
        </div>
      </div>

      {!entries && <p className="sl-dim"><Loader2 className="inline size-3 animate-spin" /> loading…</p>}
      {entries && entries.length === 0 && (
        <p className="sl-dim">Nothing logged yet. A level tells you where you are; this tells you how you got there.</p>
      )}

      <div className="sl-list">
        {(entries ?? []).map((e) => {
          const Icon = ICON[e.kind];
          return (
            <div className={cn("sl-entry", e.kind, e.resolvedAt && "resolved")} key={e.id}>
              <Icon className="size-3 shrink-0" />
              <div className="sl-body">
                <p className="sl-text">{e.text}</p>
                <div className="sl-meta">
                  <span>{fmt(e.at, { day: "2-digit", month: "short" })}</span>
                  {e.minutes ? <span>{e.minutes} min</span> : null}
                  {e.tags.map((t) => <span className="sl-tag" key={t}>{t}</span>)}
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noreferrer" className="sl-link">
                      <ExternalLink className="size-3" /> open
                    </a>
                  )}
                  {e.resolvedAt && <span className="sl-done">answered</span>}
                </div>
              </div>
              <button className="sl-del" onClick={() => void remove(e.id)} aria-label="Delete">
                <Trash2 className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
