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
    const all = (feed.data ?? []).map((i) => ({ ...i, desk: deskOf(i.title) }));
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
