"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Mail, Newspaper, Coins, Cpu, TrendingUp, Code2, Check, ChevronRight,
  ExternalLink, Loader2, Circle, CheckCircle2, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sound } from "@/lib/sound";

type StepKind = "gmail" | "feed" | "leetcode";
interface Step { id: string; label: string; kind: StepKind; source?: string; icon: typeof Mail; tint: string }

// Gyaan's morning block, in order.
const STEPS: Step[] = [
  { id: "gmail", label: "Gmail", kind: "gmail", icon: Mail, tint: "#e86a6a" },
  { id: "ft", label: "Financial Times", kind: "feed", source: "ft", icon: Newspaper, tint: "#e8a13a" },
  { id: "mint", label: "Mint", kind: "feed", source: "mint", icon: TrendingUp, tint: "#54c98a" },
  { id: "finexpress", label: "Financial Express", kind: "feed", source: "finexpress", icon: Newspaper, tint: "#5ecfd6" },
  { id: "coindesk", label: "CoinDesk", kind: "feed", source: "coindesk", icon: Coins, tint: "#e8c14a" },
  { id: "mittr", label: "MIT Tech Review", kind: "feed", source: "mittr", icon: Cpu, tint: "#9a7bff" },
  { id: "leetcode", label: "LeetCode", kind: "leetcode", icon: Code2, tint: "#ffa116" },
];

interface Headline { source: string; title: string; link: string; published: number }
interface Email { from: string; subject: string; snippet: string }
interface Daily { link: string; title: string; difficulty: string }
interface Stats { streak: number; solved: { all: number }; todaySolved: number }

const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const LS = "sage-morning";

function useDone(): [Set<string>, (id: string) => void, () => void] {
  const [done, setDone] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS) ?? "null");
      if (raw?.day === dayKey()) setDone(new Set(raw.ids));
    } catch { /* ignore */ }
  }, []);
  const mark = useCallback((id: string) => {
    setDone((prev) => {
      const next = new Set(prev); next.add(id);
      localStorage.setItem(LS, JSON.stringify({ day: dayKey(), ids: [...next] }));
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    setDone(new Set());
    localStorage.setItem(LS, JSON.stringify({ day: dayKey(), ids: [] }));
  }, []);
  return [done, mark, reset];
}

export function MorningBlock() {
  const [active, setActive] = useState(0);
  const [done, mark, reset] = useDone();
  const [feed, setFeed] = useState<Headline[] | null>(null);
  const [emails, setEmails] = useState<Email[] | null | undefined>(undefined);
  const [lc, setLc] = useState<{ daily: Daily | null; stats: Stats | null; hasUser: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Record<string, Headline[]>>({});

  const step = STEPS[active];

  // load content for the active step
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    (async () => {
      if (step.kind === "gmail") {
        const j = await fetch("/api/gmail/unread").then((r) => r.json()).catch(() => null);
        if (!cancel) setEmails(j?.data?.emails ?? null);
      } else if (step.kind === "feed" && step.source) {
        if (cache.current[step.source]) { setFeed(cache.current[step.source]); }
        else {
          const j = await fetch(`/api/feeds?source=${step.source}`).then((r) => r.json()).catch(() => null);
          const items: Headline[] = j?.data?.items ?? [];
          cache.current[step.source] = items;
          if (!cancel) setFeed(items);
        }
      } else if (step.kind === "leetcode") {
        const j = await fetch("/api/leetcode").then((r) => r.json()).catch(() => null);
        if (!cancel) setLc(j?.data ?? null);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const next = () => {
    sound.blip();
    mark(step.id);
    if (active < STEPS.length - 1) setActive((a) => a + 1);
  };

  const allDone = STEPS.every((s) => done.has(s.id));
  const progress = Math.round((done.size / STEPS.length) * 100);

  return (
    <div className="mb-wrap">
      {/* rail */}
      <aside className="mb-rail">
        <div className="mb-railhead">
          <p className="lbl !text-[9px]">MORNING BLOCK</p>
          <div className="mb-progress"><span style={{ width: `${progress}%` }} /></div>
          <p className="mb-progresstxt">{done.size}/{STEPS.length} · {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short" }).format(new Date())}</p>
        </div>
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isDone = done.has(s.id);
          return (
            <button key={s.id} onClick={() => setActive(i)} className={cn("mb-step", i === active && "on", isDone && "done")}>
              <span className="mb-stepic" style={{ color: isDone ? s.tint : undefined, borderColor: i === active ? s.tint : undefined }}>
                {isDone ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
              </span>
              <span className="mb-steplbl">{s.label}</span>
              {i === active && <ChevronRight className="ml-auto size-3.5 opacity-60" />}
            </button>
          );
        })}
        <button onClick={reset} className="mb-reset"><RotateCcw className="size-3" /> Reset today</button>
      </aside>

      {/* content */}
      <main className="mb-content">
        <div className="mb-chead">
          <span className="mb-cic" style={{ background: step.tint }}><step.icon className="size-4" /></span>
          <h2>{step.label}</h2>
          <span className="line" />
          {done.has(step.id) && <span className="mb-badge" style={{ color: step.tint }}>DONE</span>}
        </div>

        <div className="mb-body">
          {loading && <div className="mb-load"><Loader2 className="size-5 animate-spin" /></div>}

          {!loading && step.kind === "gmail" && (
            emails === null ? (
              <div className="mb-empty">Gmail not connected. <a href="/api/integrations/google" className="live">Connect →</a></div>
            ) : emails && emails.length ? (
              <div className="mb-list">
                {emails.map((e, i) => (
                  <a key={i} href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noreferrer" className="mb-item">
                    <div className="mb-itop"><span className="mb-from">{e.from}</span></div>
                    <div className="mb-title">{e.subject}</div>
                    <div className="mb-snip">{e.snippet}</div>
                  </a>
                ))}
              </div>
            ) : <div className="mb-empty">Inbox zero — nothing unread. 📭</div>
          )}

          {!loading && step.kind === "feed" && (
            feed && feed.length ? (
              <div className="mb-list">
                {feed.map((h, i) => (
                  <a key={i} href={h.link} target="_blank" rel="noreferrer" className="mb-item">
                    <div className="mb-title">{h.title} <ExternalLink className="inline size-3 opacity-40" /></div>
                    {h.published > 0 && <div className="mb-snip">{new Date(h.published).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>}
                  </a>
                ))}
              </div>
            ) : <div className="mb-empty">Couldn&apos;t reach {step.label} right now. <a href={`https://www.google.com/search?q=${encodeURIComponent(step.label)}`} target="_blank" rel="noreferrer" className="live">Open →</a></div>
          )}

          {!loading && step.kind === "leetcode" && (
            <div className="mb-lc">
              {lc?.daily ? (
                <a href={lc.daily.link} target="_blank" rel="noreferrer" className="mb-lccard">
                  <span className="lbl !text-[9px]">DAILY CHALLENGE</span>
                  <div className="mb-lctitle">{lc.daily.title}</div>
                  <span className={`mb-diff ${lc.daily.difficulty.toLowerCase()}`}>{lc.daily.difficulty}</span>
                  <span className="mb-go">Solve on LeetCode <ExternalLink className="size-3" /></span>
                </a>
              ) : <div className="mb-empty">Couldn&apos;t load today&apos;s challenge.</div>}
              {lc?.stats ? (
                <div className="mb-stats">
                  <div className="mb-stat"><b>{lc.stats.streak}</b><span>DAY STREAK</span></div>
                  <div className="mb-stat"><b>{lc.stats.solved.all}</b><span>SOLVED</span></div>
                  <div className="mb-stat"><b>{lc.stats.todaySolved}</b><span>TODAY</span></div>
                </div>
              ) : lc && !lc.hasUser ? (
                <p className="mb-hint">Add <code>LEETCODE_USERNAME</code> to see your streak &amp; solved count.</p>
              ) : null}
            </div>
          )}
        </div>

        <div className="mb-actions">
          {!allDone ? (
            <button onClick={next} className="mb-next" style={{ background: step.tint }}>
              <Check className="size-4" /> {done.has(step.id) ? "Next" : `Done — ${active < STEPS.length - 1 ? "next" : "finish"}`}
            </button>
          ) : (
            <div className="mb-finish"><CheckCircle2 className="size-5" style={{ color: "var(--live)" }} /> Morning block complete, sir. Have a sharp day.</div>
          )}
        </div>
      </main>
    </div>
  );
}
