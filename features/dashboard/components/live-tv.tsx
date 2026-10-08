"use client";

/**
 * Live television, in the wall.
 *
 * The streams component has been in the tree for months rendering nowhere.
 * This is the same idea with the channels that belong on a markets desk, and
 * the one rule that makes a video panel usable on a dashboard: nothing plays
 * until you ask it to.
 *
 * ONE channel plays, muted, from the moment the panel mounts. Twelve
 * autoplaying iframes would be twelve video decoders and a couple of hundred
 * megabytes on a page that is open all day; one is the cost of a single
 * stream, which is what a television in the corner of a room actually is.
 * Muted because a dashboard that makes noise at you without being asked is a
 * dashboard you close — and because no browser will autoplay with sound
 * anyway.
 *
 * The rest are stills down the side. Pressing one switches the player rather
 * than adding a second.
 */

import { useEffect, useState } from "react";
import { Pane } from "@/components/pane";
import { asArray } from "@/lib/as-array";
import { Play } from "lucide-react";
import { sound } from "@/lib/sound";

interface Channel { id: string; label: string; note: string }
interface Vid { id: string; title: string; channel: string; thumb: string }

/*
 * YouTube's own 24/7 live channel URLs. A live stream's video id changes when
 * the broadcaster restarts it, so these point at the CHANNEL's live endpoint
 * (`/embed/live_stream?channel=…`), which always resolves to whatever is live
 * now. Hard-coding a video id is how a "live" tile ends up showing a dead
 * player three weeks later.
 */
const CHANNELS: Channel[] = [
  { id: "UCIALMKvObZNtJ6AmdCLP7Lg", label: "Bloomberg", note: "Markets · global" },
  { id: "UCrp_UI8XtuYfpiqluWLD7Lw", label: "CNBC-TV18", note: "India · markets" },
  { id: "UCvJJ_dzjViJCoLf5uKUTwoA", label: "CNBC", note: "US · markets" },
  { id: "UCUMZ7gohGI9HcU9VNsr2FJQ", label: "Bloomberg Originals", note: "Features" },
  { id: "UC16niRr50-MSBwiO3YDb3RA", label: "BBC News", note: "World" },
  { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", label: "Al Jazeera", note: "World" },
  { id: "UCknLrEdhRCp1aegoMqRaCZg", label: "DW News", note: "Europe" },
  { id: "UCupvZG-5ko_eiXAupbDfxWw", label: "CNN", note: "World" },
  { id: "UCYfdidRxbB8Qhf0Nx7ioOYw", label: "NBC News", note: "US" },
  { id: "UC7fWeaHhqgM4Ry-RMpM2YYw", label: "TRT World", note: "World" },
  { id: "UCef5ZDkM0d-X2Au6GpSZxCA", label: "WION", note: "India · world" },
  { id: "UCt4t-jeY85JegMlZ-E5UWtA", label: "Aaj Tak", note: "India" },
];

export function LiveTv({ n }: { n?: number }) {
  /* Bloomberg by default: it is the one that belongs on a markets desk, and a
     panel whose job is "there is television on" has to start with it on. */
  const [playing, setPlaying] = useState<string>(CHANNELS[0].id);
  /*
   * A still per channel, so the panel is twelve pictures rather than twelve
   * words. A live stream has no addressable thumbnail — the route takes the
   * channel's newest upload instead, which is the right picture anyway: the
   * card says "this is Bloomberg", not "this is the current frame".
   *
   * Cached half an hour upstream, and the panel renders perfectly well before
   * it arrives, so nothing waits on it.
   */
  const [stills, setStills] = useState<Record<string, string>>({});
  /*
   * Three recent videos from the channels he follows, under the player.
   *
   * The panel was a 16:9 stage beside a 190px strip, and at four rows that
   * left most of the right-hand column empty — the live stream is one aspect
   * ratio and the tile is another. These fill it with the thing the gap was
   * next to anyway: what those channels have actually posted.
   */
  const [videos, setVideos] = useState<Vid[]>([]);
  useEffect(() => {
    fetch("/api/youtube", { signal: AbortSignal.timeout(25_000) })
      .then((r) => r.json())
      .then((j) => setVideos(asArray<Vid>(j?.data?.videos).slice(0, 3)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    fetch(`/api/tv?ids=${CHANNELS.map((c) => c.id).join(",")}`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setStills(j.data as Record<string, string>); })
      .catch(() => {});
  }, []);

  const current = CHANNELS.find((c) => c.id === playing) ?? CHANNELS[0];

  return (
    <Pane n={n} title="Live" status={`${current.label} · muted`} live>
      <div className="tv">
        <div className="tv-stage">
          <iframe
            key={playing}
            src={`https://www.youtube-nocookie.com/embed/live_stream?channel=${playing}&autoplay=1&mute=1&playsinline=1`}
            title={current.label}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>

        <div className="tv-side">
          {videos.length > 0 && (
            <div className="tv-saved">
              <div className="tv-sh">Latest from your channels</div>
              {videos.map((v) => (
                <a className="tv-vid" key={v.id} href={`https://www.youtube.com/watch?v=${v.id}`}
                   target="_blank" rel="noopener noreferrer" title={v.title}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.thumb} alt="" loading="lazy" />
                  <span className="tv-vbody">
                    <span className="tv-vt">{v.title}</span>
                    <span className="tv-vc">{v.channel}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
          <div className="tv-strip">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              className={`tv-card${c.id === playing ? " on" : ""}`}
              onClick={() => { setPlaying(c.id); sound.latch(true); }}
              onPointerEnter={() => sound.hover()}
              aria-pressed={c.id === playing}
            >
              {stills[c.id] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="tv-still" src={stills[c.id]} alt="" loading="lazy" />
              )}
              <span className="tv-shade" aria-hidden />
              {c.id === playing ? <span className="tv-on" aria-hidden /> : <span className="tv-play"><Play className="size-3" /></span>}
              <span className="tv-name">{c.label}</span>
              <span className="tv-note">{c.note}</span>
            </button>
          ))}
          </div>
        </div>
      </div>
    </Pane>
  );
}
