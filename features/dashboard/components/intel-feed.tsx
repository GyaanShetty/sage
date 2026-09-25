"use client";

/**
 * The wire.
 *
 * Time, desk, headline — the shape the reference draws, built on the news
 * SAGE already pulls. The desks are keyword-derived (lib/classify.ts), so the
 * source stays visible beside each one: a heuristic that is occasionally
 * wrong is fine as long as you can see where the item actually came from.
 *
 * Every row is a link out. A feed you cannot open is a list of things you now
 * have to go and search for.
 */

import { useMemo, useState } from "react";
import { Pane, Empty } from "@/components/pane";
import { useFeed } from "@/lib/feed";
import { Fresh } from "@/components/fresh";
import { deskOf, type Desk } from "@/lib/classify";
import { TZ } from "@/lib/config";
import { sound } from "@/lib/sound";

interface Item { source: string; title: string; link: string; published: number }

const TABS: (Desk | "ALL")[] = ["ALL", "MARKETS", "TECH", "GEO", "AI", "DEFENSE"];

const hhmm = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(ms));

export function IntelFeed({ n, limit = 12 }: { n?: number; limit?: number }) {
  const [tab, setTab] = useState<Desk | "ALL">("ALL");
  const feed = useFeed<Item[]>("/api/news", { everyMs: 5 * 60_000 });

  const rows = useMemo(() => {
    /*
     * One story, one row.
     *
     * The wire pulls several feeds, and a syndicated story appears in more
     * than one of them — same headline, different link, so nothing upstream
     * treats them as the same item. On screen that read as the feed
     * stuttering: the same headline twice, two rows apart, which makes the
     * whole panel look broken even though both rows are real.
     *
     * Keyed on the headline with punctuation and case dropped, because that
     * is what the copies agree on; the link never is. The earliest copy wins,
     * so the time column still says when the story broke rather than when the
     * slowest aggregator got round to it.
     */
    const seen = new Map<string, Item & { desk: Desk }>();
    for (const i of feed.data ?? []) {
      const key = i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const prev = seen.get(key);
      if (!prev || i.published < prev.published) seen.set(key, { ...i, desk: deskOf(i.title) });
    }
    const all = [...seen.values()].sort((a, b) => b.published - a.published);
    return tab === "ALL" ? all : all.filter((i) => i.desk === tab);
  }, [feed.data, tab]);

  return (
    <Pane
      n={n}
      title="Live Intelligence Feed"
      status={<Fresh feed={feed} />}
      live={(feed.data?.length ?? 0) > 0}
    >
      <div className="wire">
        <div className="wire-tabs" role="tablist" aria-label="Desk">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tab}
              className={t === tab ? "on" : undefined}
              onClick={() => { setTab(t); sound.detent(); }}
              onPointerEnter={() => sound.hover()}
            >
              {t}
            </button>
          ))}
        </div>

        {rows.length === 0
          ? <Empty reason={feed.data?.length ? `Nothing on the ${tab.toLowerCase()} desk right now` : "Waiting on the wire"} />
          : (
            <div className="wire-rows">
              {rows.slice(0, limit).map((i) => (
                <a
                  key={i.link}
                  className="wire-row"
                  href={i.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${i.source} — ${i.title}`}
                >
                  <span className="wire-t">{hhmm(i.published)}</span>
                  <span className={`wire-desk d-${i.desk.toLowerCase()}`}>{i.desk}</span>
                  <span className="wire-h">{i.title}</span>
                  <span className="wire-src">{i.source}</span>
                </a>
              ))}
            </div>
          )}
      </div>
    </Pane>
  );
}
