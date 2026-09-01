"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Mail, Newspaper, Coins, Cpu, TrendingUp, Code2, Check, ChevronRight,
  ExternalLink, Loader2, CheckCircle2, RotateCcw, Sparkles, Link2, Plus, FileText, CandlestickChart, Volume2, Square, Video, Play, Zap,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { sound } from "@/lib/sound";
import { speakLowLatency, forgetRest } from "@/lib/speak";
import { ResearchPanel } from "./research-panel";
import "@/features/dashboard/command.css";
import { TZ } from "@/lib/config";

type StepKind = "gmail" | "feed" | "leetcode" | "synthesis" | "watch";
interface Step { id: string; label: string; kind: StepKind; source?: string; icon: typeof Mail; tint: string }

// Gyaan's morning block, in order.
const STEPS: Step[] = [
  { id: "gmail", label: "Gmail", kind: "gmail", icon: Mail, tint: "#e86a6a" },
  { id: "ft", label: "Financial Times", kind: "feed", source: "ft", icon: Newspaper, tint: "#ff3b30" },
  { id: "mint", label: "Mint", kind: "feed", source: "mint", icon: TrendingUp, tint: "#54c98a" },
  { id: "finexpress", label: "Financial Express", kind: "feed", source: "finexpress", icon: Newspaper, tint: "#f4f5f7" },
  { id: "coindesk", label: "CoinDesk", kind: "feed", source: "coindesk", icon: Coins, tint: "#e8c14a" },
  { id: "mittr", label: "MIT Tech Review", kind: "feed", source: "mittr", icon: Cpu, tint: "#9a7bff" },
  { id: "watch", label: "Watch", kind: "watch", icon: Video, tint: "#ff4d4d" },
  { id: "leetcode", label: "LeetCode", kind: "leetcode", icon: Code2, tint: "#ffa116" },
  { id: "synthesis", label: "Synthesis", kind: "synthesis", icon: Sparkles, tint: "#f4f5f7" },
];

interface Synthesis { summary: string; connections: string[]; watch: string[]; actions: string[]; spoken?: string }
interface Video { id: string; title: string; channel: string; thumb: string }

interface Headline { source: string; title: string; link: string; published: number; image?: string }
interface Digest {
  gist: string; themes: string[]; mustRead: string; mustReadLink: string; skip: string; source: string; count: number;
}
interface Email { from: string; subject: string; snippet: string; id?: string; important?: boolean }
interface Daily { link: string; title: string; difficulty: string }
interface Stats { streak: number; solved: { all: number }; todaySolved: number; calendar?: Record<string, number> }

const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
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
  const [syn, setSyn] = useState<Synthesis | null>(null);
  // Bumped by "Rewrite": asks the API to bypass its half-day cache and take
  // a different angle, rather than replaying the brief you just read.
  const [synNonce, setSynNonce] = useState(0);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  // article summaries: link → {loading, summary}
  const [summaries, setSummaries] = useState<Record<string, { loading: boolean; summary?: string }>>({});
  const [openArticle, setOpenArticle] = useState<string | null>(null);
  const [savedTasks, setSavedTasks] = useState<Set<string>>(new Set());
  // suggestion → automation state: "designing" while the AI builds it, name once deployed
  const [autos, setAutos] = useState<Record<string, { state: "designing" | "done" | "error"; name?: string }>>({});
  const [savedNote, setSavedNote] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Record<string, Headline[]>>({});
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const digestCache = useRef<Record<string, Digest>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
        const src = step.source;
        if (cache.current[src]) { setFeed(cache.current[src]); }
        else {
          const j = await fetch(`/api/feeds?source=${src}`).then((r) => r.json()).catch(() => null);
          const items: Headline[] = j?.data?.items ?? [];
          cache.current[src] = items;
          if (!cancel) setFeed(items);
        }

        // The per-source read, fetched separately so the headlines appear
        // immediately and the summary catches up — it needs a model call, and
        // blocking the list on it would make every source feel slow.
        setDigest(digestCache.current[src] ?? null);
        if (!digestCache.current[src]) {
          setDigestLoading(true);
          const d = await fetch(`/api/feeds/digest?source=${src}`).then((r) => r.json()).catch(() => null);
          if (!cancel) {
            const got = (d?.data as Digest | null) ?? null;
            if (got) digestCache.current[src] = got;
            setDigest(got);
            setDigestLoading(false);
          }
        }
      } else if (step.kind === "leetcode") {
        const j = await fetch("/api/leetcode").then((r) => r.json()).catch(() => null);
        if (!cancel) setLc(j?.data ?? null);
      } else if (step.kind === "watch") {
        const j = await fetch("/api/youtube").then((r) => r.json()).catch(() => null);
        if (!cancel) setVideos(j?.data?.videos ?? []);
      } else if (step.kind === "synthesis") {
        const j = await fetch(`/api/morning/synthesis${synNonce ? "?refresh=1" : ""}`).then((r) => r.json()).catch(() => null);
        const data: Synthesis | null = j?.data ?? null;
        // Do NOT auto-play — SAGE only speaks when you press Listen.
        if (!cancel) setSyn(data);
      }
      if (!cancel) setLoading(false);
    })();
    // Deliberately does NOT stop the speech.
    //
    // This cleanup runs on every `active` change, not only on unmount — so
    // stopping playback here meant pressing Listen and then touching anything
    // in the brief (Next, or any step in the rail) killed the audio
    // mid-sentence. Reading along while it talks is the obvious way to use
    // this, which is why it felt random rather than like a button doing it.
    //
    // Speech now ends only when he stops it or the block actually goes away.
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, synNonce]);


  const next = () => {
    sound.blip();
    mark(step.id);
    if (active < STEPS.length - 1) setActive((a) => a + 1);
  };

  const summarize = async (h: Headline) => {
    if (openArticle === h.link) { setOpenArticle(null); return; }
    setOpenArticle(h.link);
    if (summaries[h.link]?.summary) return; // cached
    setSummaries((s) => ({ ...s, [h.link]: { loading: true } }));
    const j = await fetch("/api/article/summary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: h.title, link: h.link }) }).then((r) => r.json()).catch(() => null);
    setSummaries((s) => ({ ...s, [h.link]: { loading: false, summary: j?.data?.summary ?? "Couldn't summarize this one." } }));
  };

  const addTask = async (title: string) => {
    setSavedTasks((s) => new Set(s).add(title));
    await fetch("/api/task", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }).catch(() => {});
  };

  // Turn a suggested action into a deployed, recurring automation (SAGE designs it).
  const automate = async (suggestion: string) => {
    if (autos[suggestion]?.state === "designing" || autos[suggestion]?.state === "done") return;
    setAutos((a) => ({ ...a, [suggestion]: { state: "designing" } }));
    try {
      const j = await fetch("/api/automation/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestion }),
      }).then((r) => r.json());
      setAutos((a) => ({
        ...a,
        [suggestion]: j?.ok ? { state: "done", name: j.data?.name } : { state: "error" },
      }));
    } catch {
      setAutos((a) => ({ ...a, [suggestion]: { state: "error" } }));
    }
  };

  const stopSpeak = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    // Stop means stop: without this the next part starts by itself a moment
    // after the pause, which is worse than not stopping at all.
    forgetRest();
    setSpeaking(false);
  }, []);

  /**
   * The only automatic stop: actually leaving.
   *
   * Empty deps, so this runs once on unmount and never on a step change —
   * which is the whole point. Navigating away should not leave SAGE talking to
   * an empty room; clicking "Next" inside the brief should not silence it.
   */
  useEffect(() => () => stopSpeak(), [stopSpeak]);

  const synText = (s: Synthesis) =>
    [s.summary, ...s.connections.slice(0, 3), s.watch.length ? `To watch today: ${s.watch[0]}` : ""].filter(Boolean).join(". ");

  const speakText = useCallback(async (text: string) => {
    setSpeaking(true);
    const audio = await speakLowLatency(text, { fast: true, onended: () => setSpeaking(false) });
    audioRef.current = audio;
    if (!audio) setSpeaking(false); // browser-synth path manages its own end
  }, []);

  const speakSynthesis = () => {
    if (speaking) { stopSpeak(); return; }
    // Speak the distinct short spoken script — the insight + a suggestion —
    // not the on-screen text. Falls back to the summary if unavailable.
    if (syn) speakText(syn.spoken?.trim() || synText(syn));
  };

  const saveBrief = async () => {
    if (!syn || savedNote) return;
    setSavedNote(true);
    const body = [syn.summary, "", ...syn.connections.map((c) => `• ${c}`), "", "Watch: " + syn.watch.join("; ")].join("\n");
    await fetch("/api/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: `Morning brief — ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date())}`, content: body }),
    }).catch(() => {});
    window.dispatchEvent(new CustomEvent("sage:memory-updated"));
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
              <>
                {(["important", "normal"] as const).map((band) => {
                  const list = emails.filter((e) => (band === "important" ? e.important : !e.important));
                  if (!list.length) return null;
                  return (
                    <div key={band} className="mb-mailsec">
                      <span className={cn("mb-mailhead", band === "important" && "imp")}>{band === "important" ? "★ IMPORTANT" : "EVERYTHING ELSE"} · {list.length}</span>
                      <div className="mb-list">
                        {list.map((e, i) => (
                          <a key={i} href={e.id ? `https://mail.google.com/mail/u/0/#inbox/${e.id}` : "https://mail.google.com/mail/u/0/#inbox"} target="_blank" rel="noreferrer" className="mb-item">
                            <div className="mb-itop"><span className="mb-from">{e.from}</span></div>
                            <div className="mb-title">{e.subject}</div>
                            <div className="mb-snip">{e.snippet}</div>
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            ) : <div className="mb-empty">Inbox zero — nothing unread. 📭</div>
          )}

          {!loading && step.kind === "feed" && (digest || digestLoading) && (
            <div className="mb-digest">
              <span className="lbl !text-[9px]"><Newspaper className="inline size-3" /> WHAT {step.label.toUpperCase()} IS LEADING WITH</span>
              {digestLoading && !digest && <p className="mb-digestwait">Reading the front page…</p>}
              {digest && (
                <>
                  <p className="mb-digestgist">{digest.gist}</p>
                  {digest.themes.length > 0 && (
                    <div className="mb-digestthemes">
                      {digest.themes.map((t) => <span className="mb-theme" key={t}>{t}</span>)}
                    </div>
                  )}
                  <div className="mb-digestfoot">
                    <a href={digest.mustReadLink} target="_blank" rel="noreferrer" className="mb-digestpick">
                      <ExternalLink className="size-3" /> {digest.mustRead}
                    </a>
                    {digest.skip && <span className="mb-digestskip">Skip: {digest.skip}</span>}
                  </div>
                </>
              )}
            </div>
          )}

          {!loading && step.kind === "feed" && (
            feed && feed.length ? (
              <div className="mb-list">
                {feed.map((h, i) => {
                  const open = openArticle === h.link;
                  const sum = summaries[h.link];
                  return (
                    <div key={i} className={cn("mb-item", open && "mb-item-open")}>
                      <button className="mb-artbtn" onClick={() => summarize(h)}>
                        {h.image && <img src={h.image} alt="" className="mb-thumb" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />}
                        <div className="mb-itemtext">
                          <div className="mb-title">{h.title}</div>
                          <div className="mb-snip">
                            {h.published > 0 && new Date(h.published).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            <span className="mb-artcue"> · {open ? "hide" : "AI summary"}</span>
                          </div>
                        </div>
                      </button>
                      {open && (
                        <div className="mb-artsum">
                          {sum?.loading ? <span className="mb-artload"><Loader2 className="size-3.5 animate-spin" /> Reading the article…</span>
                            : <p>{sum?.summary}</p>}
                          <a href={h.link} target="_blank" rel="noreferrer" className="mb-artopen">Open full article <ExternalLink className="size-3" /></a>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                  <span className="mb-go">Open on LeetCode <ExternalLink className="size-3" /></span>
                </a>
              ) : <div className="mb-empty">Couldn&apos;t load today&apos;s challenge.</div>}

              {lc?.daily && (
                <Link href="/code" className="mb-lcsolve">
                  <Code2 className="size-3.5" /> SOLVE IT IN SAGE — editor, runner, and a coach that won&apos;t just tell you
                </Link>
              )}
              {lc?.stats ? (
                <div className="mb-stats">
                  <div className="mb-stat"><b>{lc.stats.streak}</b><span>DAY STREAK</span></div>
                  <div className="mb-stat"><b>{lc.stats.solved.all}</b><span>SOLVED</span></div>
                  <div className="mb-stat"><b>{lc.stats.todaySolved}</b><span>TODAY</span></div>
                </div>
              ) : lc && !lc.hasUser ? (
                <p className="mb-hint">Add <code>LEETCODE_USERNAME</code> to see your streak &amp; solved count.</p>
              ) : null}
              {lc?.stats?.calendar && <LeetHeatmap calendar={lc.stats.calendar} />}
            </div>
          )}

          {!loading && step.kind === "watch" && (
            videos && videos.length ? (
              <div className="mb-vids">
                {videos.map((v) => (
                  <div key={v.id} className="mb-vid">
                    {playing === v.id ? (
                      <div className="mb-vidframe">
                        <iframe
                          src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1`}
                          title={v.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      <button className="mb-vidthumb" onClick={() => setPlaying(v.id)}>
                        <img src={v.thumb} alt="" loading="lazy" />
                        <span className="mb-vidplay"><Play className="size-5" /></span>
                      </button>
                    )}
                    <div className="mb-vidmeta">
                      <div className="mb-vidtitle">{v.title}</div>
                      <div className="mb-vidch">{v.channel}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="mb-empty">No videos right now. Set <code>MORNING_YT_CHANNELS</code> to your favourite channels.</div>
          )}

          {!loading && step.kind === "synthesis" && (
            syn ? (
              <div className="mb-syn">
                <div className="mb-synhead">
                  <button
                    onClick={() => { setSyn(null); setSynNonce((n) => n + 1); }}
                    title="Write it again — a different angle on the same morning"
                    className="mb-synspeak"
                  >
                    <RotateCcw className="size-3.5" /> Rewrite
                  </button>
                  <button onClick={speakSynthesis} className={cn("mb-synspeak", speaking && "on")}>
                    {speaking ? <Square className="size-3.5" /> : <Volume2 className="size-3.5" />}
                    {speaking ? "Stop" : "Listen"}
                  </button>
                </div>
                <p className="mb-synsum">{syn.summary}</p>

                {syn.connections.length > 0 && (
                  <div className="mb-synsec">
                    <span className="lbl !text-[9px]"><Link2 className="inline size-3" /> HOW IT TOUCHES YOU</span>
                    <ul className="mb-synlist">
                      {syn.connections.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}

                {syn.watch.length > 0 && (
                  <div className="mb-synsec">
                    <div className="mb-synwatchhead">
                      <span className="lbl !text-[9px]">WATCH TODAY</span>
                      <Link href="/markets" className="mb-synmkt"><CandlestickChart className="size-3.5" /> Check Markets</Link>
                    </div>
                    <ul className="mb-synlist">
                      {syn.watch.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                {syn.actions.length > 0 && (
                  <div className="mb-synsec">
                    <span className="lbl !text-[9px]">WHAT TO DO NEXT · ADD AS TASK OR AUTOMATE IT</span>
                    <div className="mb-synacts">
                      {syn.actions.map((a, i) => {
                        const auto = autos[a];
                        return (
                          <div key={i} className="mb-synactrow">
                            <button onClick={() => addTask(a)} disabled={savedTasks.has(a)} className="mb-synact">
                              {savedTasks.has(a) ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} {a}
                            </button>
                            <button
                              onClick={() => automate(a)}
                              disabled={auto?.state === "designing" || auto?.state === "done"}
                              title="Let SAGE design a recurring automation for this"
                              className={cn("mb-synauto", auto?.state === "done" && "done", auto?.state === "error" && "err")}
                            >
                              {auto?.state === "designing" ? (
                                <><Loader2 className="size-3.5 animate-spin" /> Designing…</>
                              ) : auto?.state === "done" ? (
                                <><Check className="size-3.5" /> Automated</>
                              ) : auto?.state === "error" ? (
                                <><Zap className="size-3.5" /> Retry</>
                              ) : (
                                <><Zap className="size-3.5" /> Automate</>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {Object.values(autos).some((v) => v.state === "done") && (
                      <Link href="/automations" className="mb-synautolink">
                        <Zap className="size-3" /> View in Automations →
                      </Link>
                    )}
                  </div>
                )}

                <ResearchPanel seed={[...syn.watch, ...syn.connections].slice(0, 4)} />

                <button onClick={saveBrief} disabled={savedNote} className="mb-synsave">
                  <FileText className="size-3.5" /> {savedNote ? "Saved to workspace" : "Save brief as note"}
                </button>
              </div>
            ) : <div className="mb-empty">Synthesizing your morning…</div>
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

/** GitHub-style activity heatmap of the last ~18 weeks of LeetCode submissions. */
function LeetHeatmap({ calendar }: { calendar: Record<string, number> }) {
  const weeks = 18;
  // The calendar's keys are UTC days (LeetCode buckets them that way), so the
  // axis is stepped in UTC too. Mixing local date arithmetic with
  // toISOString() shifted every cell by a day whenever he opened this between
  // midnight and 05:30 IST — which, for someone solving problems late, is
  // exactly when the heatmap gets looked at.
  const now = new Date();
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cursor.setUTCDate(cursor.getUTCDate() - (weeks * 7 - 1));
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());   // align to Sunday

  const cols: { day: string; count: number }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: { day: string; count: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const key = cursor.toISOString().slice(0, 10);
      col.push({ day: key, count: calendar[key] ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    cols.push(col);
  }
  const level = (c: number) => (c === 0 ? 0 : c < 2 ? 1 : c < 4 ? 2 : c < 7 ? 3 : 4);
  const shade = ["#1b1c20", "rgba(255, 255, 255,0.3)", "rgba(255, 255, 255,0.5)", "rgba(255, 255, 255,0.75)", "var(--live)"];
  return (
    <div className="mb-heat">
      <span className="lbl !text-[9px]">ACTIVITY · LAST {weeks} WEEKS</span>
      <div className="mb-heatgrid">
        {cols.map((col, ci) => (
          <div key={ci} className="mb-heatcol">
            {col.map((cell, ri) => (
              <span key={ri} title={`${cell.day}: ${cell.count} submission${cell.count === 1 ? "" : "s"}`} style={{ background: shade[level(cell.count)] }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
