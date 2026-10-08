"use client";

/**
 * What everyone is covering at once.
 *
 * Derived from the eight feeds already pulled rather than from a trending
 * API, and ranked by how many distinct publishers carry a name — a story
 * mentioned five times by one outlet is that outlet having a position; the
 * same name in the FT, Mint and CoinDesk is a thing that is happening.
 *
 * Each topic opens to the headlines behind it, because "Infosys" on its own
 * is a word and the point is what about Infosys.
 */

import { useState } from "react";
import { Pane, Empty } from "@/components/pane";
import { useFeed } from "@/lib/feed";
import { asArray } from "@/lib/as-array";
import { TZ } from "@/lib/config";
import { sound } from "@/lib/sound";

interface Story { title: string; link: string; source: string; published: number }
interface Topic { term: string; sources: number; mentions: number; stories: Story[] }

const hhmm = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));

export function HotTopics({ n }: { n?: number }) {
  const feed = useFeed<{ topics: Topic[]; of: number }>("/api/hot", { everyMs: 10 * 60_000 });
  const [open, setOpen] = useState<string | null>(null);

  const topics = asArray<Topic>(feed.data?.topics);
  const max = Math.max(2, ...topics.map((t) => t.sources));

  return (
    <Pane
      n={n}
      title="Hot"
      status={feed.data ? `across ${feed.data.of} stories` : "reading…"}
      live={topics.length > 0}
    >
      {!topics.length
        ? <Empty reason={feed.loading ? "Reading the wire…" : "Nothing is being covered by more than one outlet right now"} />
        : (
          <div className="ht">
            {topics.map((t) => (
              <div className="ht-item" key={t.term}>
                <button
                  className={`ht-row${open === t.term ? " on" : ""}`}
                  onClick={() => { setOpen(open === t.term ? null : t.term); sound.detent(); }}
                  aria-expanded={open === t.term}
                >
                  <span className="ht-term">{t.term}</span>
                  {/* Breadth as a length, so a column of them compares. */}
                  <span className="ht-bar" aria-hidden><i style={{ width: `${(t.sources / max) * 100}%` }} /></span>
                  <span className="ht-n num">{t.sources}</span>
                </button>
                {open === t.term && (
                  <div className="ht-stories">
                    {t.stories.map((s) => (
                      <a className="ht-story" key={s.link} href={s.link} target="_blank" rel="noopener noreferrer">
                        <span className="ht-when num">{hhmm(s.published)}</span>
                        <span className="ht-h">{s.title}</span>
                        <span className="ht-src">{s.source}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </Pane>
  );
}
