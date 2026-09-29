"use client";

/**
 * The morning block, on the wall.
 *
 * Everything here already existed and was reachable only by walking the
 * nine-step morning flow: the five publishers Gyaan actually reads, and the
 * YouTube channels behind the Watch step. Once the block is done for the day
 * the whole thing became unreachable until tomorrow, and the dashboard — the
 * screen that is open all day — carried a generic wire instead.
 *
 * So the same sources, as a panel: one tab per publisher, headlines that open
 * where they came from, and the day's videos with their links. No new
 * upstreams; /api/feeds and /api/youtube were already serving all of it.
 */

import { useCallback, useEffect, useState } from "react";
import { Pane, Empty } from "@/components/pane";
import { Play, ExternalLink } from "lucide-react";
import { TZ } from "@/lib/config";
import { asArray } from "@/lib/as-array";
import { sound } from "@/lib/sound";

interface Headline { source: string; title: string; link: string; published: number }
interface Video { id: string; title: string; channel: string; thumb: string }

/* The order he reads them in. WATCH is last because it is the one that takes
   a quarter of an hour rather than a glance. */
const TABS = [
  { key: "ft", label: "FT" },
  { key: "mint", label: "MINT" },
  { key: "finexpress", label: "FIN EXP" },
  { key: "coindesk", label: "COINDESK" },
  { key: "mittr", label: "MIT TR" },
  { key: "watch", label: "WATCH" },
] as const;

const hhmm = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(ms));

export function MorningWire({ n }: { n?: number }) {
  const [tab, setTab] = useState<string>("ft");
  /* Cached per tab, so flipping back and forth does not re-fetch a feed that
     refreshes hourly at best. */
  const [feeds, setFeeds] = useState<Record<string, Headline[] | null>>({});
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (key: string) => {
    if (key === "watch") {
      if (videos !== null) return;
      setBusy(true);
      const j = await fetch("/api/youtube", { signal: AbortSignal.timeout(15000) })
        .then((r) => r.json()).catch(() => null);
      setVideos(asArray<Video>(j?.data?.videos));
      setBusy(false);
      return;
    }
    if (feeds[key] !== undefined) return;
    setBusy(true);
    const j = await fetch(`/api/feeds?source=${key}`, { signal: AbortSignal.timeout(15000) })
      .then((r) => r.json()).catch(() => null);
    setFeeds((f) => ({ ...f, [key]: asArray<Headline>(j?.data) }));
    setBusy(false);
  }, [feeds, videos]);

  useEffect(() => { void load(tab); }, [tab, load]);

  const rows = feeds[tab];
  const anything = tab === "watch" ? (videos?.length ?? 0) > 0 : (rows?.length ?? 0) > 0;

  return (
    <Pane n={n} title="Morning Wire" status={busy ? "READING…" : TABS.find((t) => t.key === tab)?.label} live={anything}>
      <div className="wire">
        <div className="wire-tabs" role="tablist" aria-label="Source">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.key === tab}
              className={t.key === tab ? "on" : undefined}
              onClick={() => { setTab(t.key); sound.detent(); }}
              onPointerEnter={() => sound.hover()}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "watch" ? (
          videos === null ? <Empty reason="Loading the channels…" />
          : videos.length === 0 ? <Empty reason="No videos from your channels today" />
          : (
            <div className="mw-vids">
              {videos.map((v) => (
                <a key={v.id} className="mw-vid" href={`https://www.youtube.com/watch?v=${v.id}`}
                   target="_blank" rel="noopener noreferrer" title={v.title}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.thumb} alt="" loading="lazy" />
                  <span className="mw-vplay"><Play className="size-3" /></span>
                  <span className="mw-vbody">
                    <span className="mw-vtitle">{v.title}</span>
                    <span className="mw-vchan">{v.channel}</span>
                  </span>
                </a>
              ))}
            </div>
          )
        ) : rows === undefined || rows === null ? <Empty reason="Loading…" />
          : rows.length === 0 ? <Empty reason={`Nothing from ${TABS.find((t) => t.key === tab)?.label} today`} />
          : (
            <div className="wire-rows">
              {rows.slice(0, 14).map((h) => (
                <a key={h.link} className="wire-row" href={h.link} target="_blank" rel="noopener noreferrer" title={h.title}>
                  <span className="wire-t">{hhmm(h.published)}</span>
                  <span className="wire-h">{h.title}</span>
                  <ExternalLink className="mw-out size-3" aria-hidden />
                </a>
              ))}
            </div>
          )}
      </div>
    </Pane>
  );
}
