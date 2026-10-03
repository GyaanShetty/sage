"use client";

/**
 * The morning read.
 *
 * The publishers Gyaan actually reads, which were previously reachable only by
 * walking a nine-step morning flow and then not at all once it was finished for
 * the day. One tab each, plus the wire and the videos.
 *
 * Headlines open where they came from. There is no summariser, no digest, no
 * "must read" pick — those were a model's opinion standing between him and the
 * article, and the article is right there.
 */

import { useCallback, useEffect, useState } from "react";
import { Play } from "lucide-react";
import { asArray } from "@/lib/as-array";
import { TZ } from "@/lib/config";

interface Headline { source: string; title: string; link: string; published: number }
interface Video { id: string; title: string; channel: string; thumb: string }

const TABS = [
  { key: "wire", label: "Wire" },
  { key: "ft", label: "FT" },
  { key: "mint", label: "Mint" },
  { key: "finexpress", label: "Fin Express" },
  { key: "coindesk", label: "CoinDesk" },
  { key: "mittr", label: "MIT TR" },
  { key: "watch", label: "Watch" },
] as const;

const hhmm = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(ms));

export function Read() {
  const [tab, setTab] = useState<string>("wire");
  const [cache, setCache] = useState<Record<string, Headline[]>>({});
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (key: string) => {
    if (key === "watch") {
      if (videos !== null) return;
      setBusy(true);
      const j = await fetch("/api/youtube", { signal: AbortSignal.timeout(20_000) })
        .then((r) => r.json()).catch(() => null);
      setVideos(asArray<Video>(j?.data?.videos));
      setBusy(false);
      return;
    }
    if (cache[key]) return;
    setBusy(true);
    const url = key === "wire" ? "/api/news" : `/api/feeds?source=${key}`;
    const j = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      .then((r) => r.json()).catch(() => null);
    setCache((c) => ({ ...c, [key]: asArray<Headline>(j?.data) }));
    setBusy(false);
  }, [cache, videos]);

  useEffect(() => { void load(tab); }, [tab, load]);

  const rows = cache[tab];

  return (
    <section>
      <div className="sec-h"><h2>The read</h2></div>

      <div className="tabs" role="tablist" aria-label="Source">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={t.key === tab} className="tab" onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {busy && !rows && videos === null && <p className="quiet">Loading…</p>}

      {tab === "watch" ? (
        videos?.length === 0 ? <p className="quiet">Nothing new from your channels.</p>
        : (
          <div className="rows">
            {videos?.map((v) => (
              <a className="row" key={v.id} href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer">
                <span className="vthumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.thumb} alt="" loading="lazy" />
                  <Play className="size-3" />
                </span>
                <span className="row-main">
                  <span className="row-t" style={{ whiteSpace: "normal" }}>{v.title}</span>
                  <span className="row-s">{v.channel}</span>
                </span>
              </a>
            ))}
          </div>
        )
      ) : rows?.length === 0 ? <p className="quiet">Nothing from this one today.</p>
        : (
          <div className="rows">
            {rows?.slice(0, 10).map((h) => (
              <a className="row" key={h.link} href={h.link} target="_blank" rel="noopener noreferrer">
                <span className="row-k num">{hhmm(h.published)}</span>
                <span className="row-main">
                  <span className="row-t" style={{ whiteSpace: "normal" }}>{h.title}</span>
                  {tab === "wire" && <span className="row-s">{h.source}</span>}
                </span>
              </a>
            ))}
          </div>
        )}
    </section>
  );
}
