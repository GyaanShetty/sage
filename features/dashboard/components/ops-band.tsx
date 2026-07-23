"use client";

import { useEffect, useState } from "react";
import { GitPullRequest, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { ExpandableCell } from "./expandable-cell";

interface Repo { name: string; language: string | null; pushed_at: string; private: boolean }
interface PrItem { title: string; repo: string; number: number; url: string }
interface Github { login: string | null; repos: Repo[]; openPrs: PrItem[]; reviewRequests: PrItem[] }
interface Contrib { total: number; weeks: number[][]; max: number }
interface Now { playing: boolean; track: string; artist: string; art: string | null; progress: number; duration: number }

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}M`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}H` : `${Math.round(h / 24)}D`;
}

export function OpsBand() {
  const [gh, setGh] = useState<Github | null | undefined>(undefined);
  const [now, setNow] = useState<Now | null | undefined>(undefined);
  const [contrib, setContrib] = useState<Contrib | null>(null);

  useEffect(() => {
    fetch("/api/github").then((r) => r.json()).then((j) => setGh(j.data)).catch(() => setGh(null));
    fetch("/api/github/contributions").then((r) => r.json()).then((j) => setContrib(j.data)).catch(() => {});
    const pull = () => fetch("/api/spotify").then((r) => r.json()).then((j) => setNow(j.data)).catch(() => setNow(null));
    pull();
    const t = setInterval(pull, 15000);
    return () => clearInterval(t);
  }, []);

  const control = async (action: string) => {
    await fetch("/api/spotify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    setTimeout(() => fetch("/api/spotify").then((r) => r.json()).then((j) => setNow(j.data)).catch(() => {}), 400);
  };

  return (
    <section className="section" id="ops" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">04</span><h2>Operations</h2><span className="line" /><span className="tag">GITHUB · MEDIA</span></div>
      <div className="grid deckmc">
        {/* GitHub */}
        <ExpandableCell title="GitHub" tag="OPS">
          <div className="bh"><span className="t">GitHub</span><span className="i">GIT</span><span className="r">{gh?.login ? `@${gh.login}` : "—"}</span></div>
          {gh === undefined && <p className="lbl">SYNCING…</p>}
          {gh === null && (
            <div className="empty-state">
              <GitPullRequest className="es-mark size-5" strokeWidth={1.5} />
              <div className="es-t">GitHub offline</div>
              <div className="es-d">Set GITHUB_TOKEN in the environment</div>
            </div>
          )}
          {gh && (
            <>
              {gh.reviewRequests.length > 0 && (
                <>
                  <p className="lbl" style={{ marginBottom: 6 }}>AWAITING YOUR REVIEW</p>
                  {gh.reviewRequests.slice(0, 3).map((p) => (
                    <a className="news" key={p.url} href={p.url} target="_blank" rel="noreferrer">
                      <span className="ns">{p.repo} #{p.number}</span>
                      <div className="nh">{p.title}</div>
                    </a>
                  ))}
                </>
              )}
              {contrib && (
                <>
                  <p className="lbl" style={{ margin: "10px 0 6px" }}>{contrib.total.toLocaleString()} CONTRIBUTIONS · PAST YEAR</p>
                  <div className="ghgrid">
                    {contrib.weeks.flatMap((w, wi) =>
                      w.map((c, di) => {
                        const lvl = c === 0 ? 0 : Math.min(4, Math.ceil((c / contrib.max) * 4));
                        return <div className={`ghcell${lvl ? ` l${lvl}` : ""}`} key={`${wi}-${di}`} title={`${c} on this day`} />;
                      }),
                    )}
                  </div>
                </>
              )}
              <p className="lbl" style={{ margin: "10px 0 6px" }}>RECENT REPOS</p>
              {gh.repos.slice(0, 5).map((r) => (
                <div className="mkt" key={r.name}>
                  <span className="sym" style={{ width: "auto", flex: 1 }}>{r.name}</span>
                  <span className="chg">{r.language ?? "—"}</span>
                  <span className="px" style={{ width: 44, flex: "0 0 44px" }}>{ago(r.pushed_at)}</span>
                </div>
              ))}
              {gh.repos.length === 0 && gh.reviewRequests.length === 0 && (
                <div className="empty-state"><div className="es-t">All caught up</div><div className="es-d">No repos or reviews pending</div></div>
              )}
            </>
          )}
        </ExpandableCell>
        {/* Spotify */}
        <ExpandableCell title="Now Playing" tag="SPOTIFY" className="!flex flex-col">
          <div className="bh"><span className="t">Now Playing</span><span className="i">SPO</span><span className="r">SPOTIFY</span></div>
          {now === undefined && <p className="lbl">CONNECTING…</p>}
          {now === null && (
            <div className="empty-state" style={{ margin: "auto" }}>
              <Play className="es-mark size-5" strokeWidth={1.5} />
              <div className="es-t">Spotify not connected</div>
              <div className="es-d"><a href="/api/integrations/spotify" className="live">Connect Spotify →</a></div>
            </div>
          )}
          {now && !now.track && (
            <div className="empty-state" style={{ margin: "auto" }}>
              <div className="es-t">Nothing playing</div>
              <div className="es-d">Start something on Spotify</div>
            </div>
          )}
          {now && now.track && (
            <div style={{ margin: "auto 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              {now.art && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={now.art} alt="" width={120} height={120} style={{ border: "1px solid var(--border-glass)" }} />
              )}
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 400 }}>{now.track}</div>
                <div className="lbl" style={{ marginTop: 4 }}>{now.artist}</div>
              </div>
              <div style={{ width: "100%", maxWidth: 200 }}>
                <div style={{ height: 2, background: "var(--hairbg)", position: "relative" }}>
                  <div style={{ position: "absolute", inset: 0, right: "auto", width: `${now.duration ? (now.progress / now.duration) * 100 : 0}%`, background: "var(--live)" }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <button onClick={() => control("previous")} className="text-muted hover:text-foreground"><SkipBack className="size-4" /></button>
                <button onClick={() => control(now.playing ? "pause" : "play")} className="text-foreground">
                  {now.playing ? <Pause className="size-6" /> : <Play className="size-6" />}
                </button>
                <button onClick={() => control("next")} className="text-muted hover:text-foreground"><SkipForward className="size-4" /></button>
              </div>
            </div>
          )}
        </ExpandableCell>
      </div>
    </section>
  );
}
