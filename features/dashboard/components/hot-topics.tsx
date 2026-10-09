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

import { useState, useMemo } from "react";
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

  /*
   * Who is driving today's coverage.
   *
   * Derived from the stories already in this response rather than fetched —
   * every topic carries its stories and every story names its source, so the
   * distribution is sitting in the payload unused. It answers a question the
   * topic list cannot: whether "everyone is covering this" means six
   * publishers or means the Economic Times six times.
   *
   * Ranked bars, one series, so no legend — the title names it — and the
   * values direct-labelled rather than axed, because six rows do not need an
   * axis to be compared.
   */
  const bySource = useMemo(() => {
    const seen = new Map<string, Set<string>>();
    for (const t of topics) for (const st of t.stories ?? []) {
      if (!st?.source) continue;
      if (!seen.has(st.source)) seen.set(st.source, new Set());
      seen.get(st.source)!.add(st.title);
    }
    return [...seen].map(([source, titles]) => ({ source, n: titles.size }))
      .sort((a, b) => b.n - a.n || a.source.localeCompare(b.source))
      .slice(0, 6);
  }, [topics]);
  const srcMax = Math.max(1, ...bySource.map((x) => x.n));

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
            {bySource.length > 1 && (
              <div className="hs">
                <div className="hs-h">Who is running it</div>
                {bySource.map((x) => (
                  <div className="hs-row" key={x.source}>
                    <span className="hs-s">{x.source}</span>
                    <span className="hs-bar" aria-hidden><i style={{ width: `${(x.n / srcMax) * 100}%` }} /></span>
                    <span className="hs-n num">{x.n}</span>
                  </div>
                ))}
              </div>
            )}
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
