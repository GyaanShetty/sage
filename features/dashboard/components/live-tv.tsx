"use client";

/**
 * Three televisions, side by side.
 *
 * It was one 16:9 stage with a column of stills beside it, and the stage won
 * every argument about space: at four rows the player was enormous and the
 * column beside it was mostly empty. Gyaan asked for three different videos
 * instead, so this is three narrow cells of equal width, each running its own
 * channel.
 *
 * All three play from mount, muted. That is three video decoders rather than
 * one, which is a real cost and the reason the panel resisted it before — but
 * three small streams is what a wall of screens IS, and muted autoplay is the
 * only kind a browser will grant unprompted anyway. Nothing here ever makes
 * noise without being asked.
 *
 * Each cell has a picker — press the name and the full list drops down, with
 * whatever the other two screens are showing marked as taken. The arrows are
 * still there for stepping one along without thinking about it, and they
 * skip a channel already on another screen: three screens showing Bloomberg
 * is two wasted screens.
 */

import { useEffect, useState } from "react";
import { Pane } from "@/components/pane";
import { asArray } from "@/lib/as-array";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { sound } from "@/lib/sound";

interface Channel { id: string; label: string; note: string }
interface Airing { live: string | null; fallback: { id: string; title: string } | null; via: "api" | "unknown" }
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
  /*
   * The real CNBC-TV18. The id here used to be UCrp_UI8XtuYfpiqluWLD7Lw,
   * which I had labelled CNBC-TV18 and which is in fact CNBC Television —
   * a clips channel with no 24/7 stream, so the middle screen rendered
   * "This video is unavailable" every time. Both are in the list now, each
   * under its own name.
   *
   * Every id below was checked against
   * youtube.com/feeds/videos.xml?channel_id=… and the returned <title>
   * compared to the label. Worth noting for the next person: that endpoint
   * rate-limits with a 500 that looks exactly like a dead channel, so a
   * single failed check proves nothing — three of these "failed" on the
   * first pass and resolved fine on a retry. WION is the one real
   * casualty; it 404s consistently and is gone.
   */
  { id: "UCmRbHAgG2k2vDUvb3xsEunQ", label: "CNBC-TV18", note: "India · markets" },
  { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", label: "Al Jazeera", note: "World" },
  { id: "UCrp_UI8XtuYfpiqluWLD7Lw", label: "CNBC Television", note: "US · markets" },
  { id: "UCvJJ_dzjViJCoLf5uKUTwoA", label: "CNBC", note: "US · business" },
  { id: "UCUMZ7gohGI9HcU9VNsr2FJQ", label: "Bloomberg Originals", note: "Features" },
  { id: "UC16niRr50-MSBwiO3YDb3RA", label: "BBC News", note: "World" },
  { id: "UCknLrEdhRCp1aegoMqRaCZg", label: "DW News", note: "Europe" },
  { id: "UCupvZG-5ko_eiXAupbDfxWw", label: "CNN", note: "World" },
  { id: "UCYfdidRxbB8Qhf0Nx7ioOYw", label: "NBC News", note: "US" },
  { id: "UC7fWeaHhqgM4Ry-RMpM2YYw", label: "TRT World", note: "World" },
  { id: "UCt4t-jeY85JegMlZ-E5UWtA", label: "Aaj Tak", note: "India" },
];

/* Markets first, then India, then world — the order he actually reads in. */
const START = [0, 1, 2];

export function LiveTv({ n }: { n?: number }) {
  const [slots, setSlots] = useState<number[]>(START);
  /* Which screen's picker is open, if any. One at a time: two dropdowns over
     three small players leaves nothing to look at. */
  const [picking, setPicking] = useState<number | null>(null);

  /*
   * Three recent uploads from the channels he follows, as a strip under the
   * screens. The live streams are what is on now; this is what he missed.
   */
  const [videos, setVideos] = useState<Vid[]>([]);
  /*
   * What each screen can actually play.
   *
   * Embedding `/embed/live_stream?channel=…` and hoping is what produced
   * "This video is unavailable" and a playback-ID error on two of the three
   * screens: that endpoint renders YouTube's own error page when the channel
   * is not broadcasting. The route says what is live and what the newest
   * upload is, so a screen with nothing on it plays something real and
   * labels itself rather than showing an error.
   */
  const [air, setAir] = useState<Record<string, Airing>>({});
  const watching = slots.map((i) => CHANNELS[i].id).join(",");
  useEffect(() => {
    if (!watching) return;
    fetch(`/api/tv/live?ids=${watching}`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setAir((prev) => ({ ...prev, ...(j.data as Record<string, Airing>) })); })
      .catch(() => {});
  }, [watching]);

  useEffect(() => {
    fetch("/api/youtube", { signal: AbortSignal.timeout(25_000) })
      .then((r) => r.json())
      .then((j) => setVideos(asArray<Vid>(j?.data?.videos).slice(0, 3)))
      .catch(() => {});
  }, []);

  /* Put a specific channel on a specific screen. If it is already running on
     another screen the two swap rather than one being duplicated — pressing
     a channel should never leave two screens the same. */
  const put = (slot: number, ci: number) => {
    setSlots((prev) => {
      const next = [...prev];
      const other = prev.indexOf(ci);
      if (other !== -1 && other !== slot) next[other] = prev[slot];
      next[slot] = ci;
      return next;
    });
    setPicking(null);
    sound.latch(true);
  };

  /* Step one screen forward or back, skipping whatever the other two are
     already showing, so the three are always three. */
  const step = (slot: number, dir: 1 | -1) => {
    setSlots((prev) => {
      const taken = new Set(prev.filter((_, i) => i !== slot));
      let i = prev[slot];
      for (let hop = 0; hop < CHANNELS.length; hop++) {
        i = (i + dir + CHANNELS.length) % CHANNELS.length;
        if (!taken.has(i)) break;
      }
      const next = [...prev];
      next[slot] = i;
      return next;
    });
    sound.latch(true);
  };

  return (
    <Pane n={n} title="Live" status={`${slots.length} screens · muted`} live>
      <div className="tv3">
        {slots.map((ci, slot) => {
          const c = CHANNELS[ci];
          const a = air[c.id];
          /*
           * Three cases, in order of what the viewer would prefer:
           *   · a known live broadcast → play it by video id, which never
           *     renders an error page the way live_stream does;
           *   · no key to ask with → try live_stream, the no-key path, which
           *     is right whenever the channel happens to be on;
           *   · asked and nothing is live → the newest upload, labelled, so
           *     the screen is showing something true rather than grey.
           */
          const mode = a?.live ? "live" : a?.via === "api" && a.fallback ? "recent" : "stream";
          const src = mode === "live"
            ? `https://www.youtube-nocookie.com/embed/${a!.live}?autoplay=1&mute=1&playsinline=1`
            : mode === "recent"
              ? `https://www.youtube-nocookie.com/embed/${a!.fallback!.id}?autoplay=1&mute=1&playsinline=1`
              : `https://www.youtube-nocookie.com/embed/live_stream?channel=${c.id}&autoplay=1&mute=1&playsinline=1`;
          return (
            <div className="tv3-cell" key={slot}>
              <div className="tv3-stage">
                <iframe
                  key={src}
                  src={src}
                  title={c.label}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
                {mode === "recent" && (
                  <span className="tv3-badge" title={a!.fallback!.title}>NOT LIVE · LATEST</span>
                )}
              </div>
              <div className="tv3-bar">
                <button className="tv3-nav" onClick={() => step(slot, -1)}
                        onPointerEnter={() => sound.hover()} aria-label={`Previous channel on screen ${slot + 1}`}>
                  <ChevronLeft className="size-3" />
                </button>
                <button
                  className="tv3-id"
                  onClick={() => { setPicking(picking === slot ? null : slot); sound.detent(); }}
                  aria-expanded={picking === slot}
                  aria-label={`Choose the channel for screen ${slot + 1}`}
                >
                  <span className="tv3-name">{c.label}</span>
                  <span className="tv3-note">{c.note}</span>
                </button>
                <button className="tv3-nav" onClick={() => step(slot, 1)}
                        onPointerEnter={() => sound.hover()} aria-label={`Next channel on screen ${slot + 1}`}>
                  <ChevronRight className="size-3" />
                </button>
              </div>

              {picking === slot && (
                <div className="tv3-menu" role="listbox" aria-label={`Channels for screen ${slot + 1}`}>
                  {CHANNELS.map((ch, ci) => {
                    const here = slots[slot] === ci;
                    const elsewhere = !here && slots.includes(ci);
                    return (
                      <button
                        key={ch.id}
                        className={`tv3-opt${here ? " on" : ""}${elsewhere ? " taken" : ""}`}
                        role="option"
                        aria-selected={here}
                        onClick={() => put(slot, ci)}
                        onPointerEnter={() => sound.hover()}
                      >
                        <span className="tv3-oi">{here && <Check className="size-3" />}</span>
                        <span className="tv3-ol">{ch.label}</span>
                        {/* "On 2" rather than disabling it: pressing it swaps
                            the two screens, which is a useful thing to do and
                            not an error to prevent. */}
                        <span className="tv3-on2">{elsewhere ? `ON ${slots.indexOf(ci) + 1}` : ch.note}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {videos.length > 0 && (
        <div className="tv3-saved">
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
    </Pane>
  );
}
