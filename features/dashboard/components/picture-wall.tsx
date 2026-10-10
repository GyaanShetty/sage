"use client";

/**
 * The picture wall.
 *
 * Every story SAGE reads arrives with a photograph attached and until now it
 * threw all of them away but one. This is a mosaic of today's wire pictures,
 * headline over the image, newest first — the single densest thing on the
 * page and the only one you read by looking rather than by reading.
 *
 * Deliberately not a uniform grid. A mosaic where the lead story is four
 * cells and the rest are one has a focal point; a grid of equal squares is
 * wallpaper, and this panel's whole job is to be the thing the eye lands on.
 *
 * Images are desaturated until hover. Twenty-four full-colour press
 * photographs at once is a collage, and the wall around it would lose every
 * argument for attention — so the colour arrives on the one you are pointing
 * at, which is also what tells you it is a link.
 */

import { useCallback, useState } from "react";
import { Pane, Empty } from "@/components/pane";
import { useFeed } from "@/lib/feed";
import { asArray } from "@/lib/as-array";
import { TZ } from "@/lib/config";

interface Shot { title: string; link: string; source: string; published: number; image: string }

const hhmm = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));

/**
 * A tile that reports upward when its picture will not load.
 *
 * Publishers hotlink-protect aggressively — FT's CDN refuses a referrer it
 * does not recognise — and a broken-image glyph in a mosaic is worse than a
 * gap, because the mosaic reflows around a gap and cannot reflow around a
 * glyph.
 *
 * The failure is reported to the parent rather than handled here. A tile
 * that quietly deletes itself is right until EVERY tile does: then the
 * panel is an empty box under a header confidently saying "24 frames",
 * which is what it did on first run. The parent counts them so it can say
 * what actually happened.
 */
function Shot({ s, big, onFail }: { s: Shot; big?: boolean; onFail: (url: string) => void }) {
  return (
    <a
      className={`pw-cell${big ? " pw-big" : ""}`}
      href={s.link}
      target="_blank"
      rel="noopener noreferrer"
      title={s.title}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={s.image} alt="" loading="lazy" onError={() => onFail(s.image)} />
      <span className="pw-shade" aria-hidden />
      <span className="pw-meta">
        <span className="pw-src">{s.source}</span>
        <span className="pw-time num">{hhmm(s.published)}</span>
      </span>
      <span className="pw-head">{s.title}</span>
    </a>
  );
}

export function PictureWall({ n }: { n?: number }) {
  const feed = useFeed<{ shots: Shot[]; of: number }>("/api/pictures", { everyMs: 10 * 60_000 });
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const onFail = useCallback((url: string) => {
    setFailed((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  }, []);

  const shots = asArray<Shot>(feed.data?.shots);
  const shown = shots.filter((s) => !failed.has(s.image));
  /* Everything arrived and nothing could be displayed — which is a real
     state (a network that blocks image hosts, or every publisher refusing
     the referrer at once) and must not look like "no news today". */
  const allBlocked = shots.length > 0 && shown.length === 0;

  return (
    <Pane
      n={n}
      title="The Wire, in pictures"
      status={
        shown.length
          ? `${shown.length} frames · ${feed.data?.of ?? 0} stories`
          : feed.loading ? "developing…" : allBlocked ? "pictures blocked" : "no pictures"
      }
      live={shown.length > 0}
      frame
    >
      {allBlocked && (
        <Empty
          reason="Every publisher refused its picture from here — the stories are still in the wire."
          plate="news"
        />
      )}
      {!shots.length && (
        <Empty
          reason={feed.loading ? "Pulling the wire photographs…" : "Nothing on the wire came with a picture"}
          plate="news"
        />
      )}
      {shown.length > 0 && (
        <div className="pw">
          {shown.map((s, i) => <Shot key={s.image} s={s} big={i === 0 || i === 7} onFail={onFail} />)}
        </div>
      )}
    </Pane>
  );
}
