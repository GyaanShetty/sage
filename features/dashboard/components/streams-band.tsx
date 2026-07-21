"use client";

import { useEffect, useState } from "react";

interface Feed {
  label: string;
  id: string; // YouTube video id
}

// 24/7 live news + space streams as defaults; every tile is swappable.
const DEFAULTS: Feed[] = [
  { label: "SKY NEWS", id: "YDvsBbKfLPA" },
  { label: "AL JAZEERA", id: "gCNeDWCI0vo" },
  { label: "NASA ISS", id: "H999s0P1Er0" },
  { label: "LOFI FOCUS", id: "jfKfPfyJRdk" },
];

const LS_KEY = "sage-streams";

function parseYoutube(input: string): string | null {
  const m =
    input.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/) ??
    input.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}

/** 09 FEEDS — wall of live YouTube streams, mission-control style. */
export function StreamsBand() {
  const [feeds, setFeeds] = useState<Feed[]>(DEFAULTS);
  const [active, setActive] = useState<boolean[]>([false, false, false, false]);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) setFeeds(JSON.parse(saved) as Feed[]);
    } catch {}
  }, []);

  const save = (next: Feed[]) => {
    setFeeds(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {}
  };

  const applyEdit = (i: number) => {
    const id = parseYoutube(draft.trim());
    if (id) {
      const next = feeds.map((f, j) => (j === i ? { label: `FEED ${i + 1}`, id } : f));
      save(next);
      setActive((a) => a.map((v, j) => (j === i ? false : v)));
    }
    setEditing(null);
    setDraft("");
  };

  return (
    <section className="section" id="feeds" style={{ paddingTop: 0 }}>
      <div className="sectitle"><span className="sn">09</span><h2>Feeds</h2><span className="line" /><span className="tag">LIVE VIDEO · TAP TO PLAY</span></div>
      <div className="grid streams-grid">
        {feeds.map((f, i) => (
          <div className="cell stream-cell" key={i}>
            <div className="bh" style={{ marginBottom: 8 }}>
              <span className="t" style={{ fontSize: 10 }}>{f.label}</span>
              <span className="i">YT</span>
              <button className="stream-swap" onClick={() => { setEditing(editing === i ? null : i); setDraft(""); }}>
                {editing === i ? "CANCEL" : "SWAP"}
              </button>
            </div>
            {editing === i ? (
              <div className="notein" style={{ marginBottom: 0 }}>
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyEdit(i)}
                  placeholder="Paste any YouTube link…"
                />
                <button onClick={() => applyEdit(i)}>SET</button>
              </div>
            ) : active[i] ? (
              <div className="stream-frame">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${f.id}?autoplay=1&mute=1`}
                  title={f.label}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              </div>
            ) : (
              <button
                className="stream-frame stream-poster"
                style={{ backgroundImage: `url(https://i.ytimg.com/vi/${f.id}/hqdefault.jpg)` }}
                onClick={() => setActive((a) => a.map((v, j) => (j === i ? true : v)))}
                aria-label={`Play ${f.label}`}
              >
                <span className="stream-play">▶ ENGAGE</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
