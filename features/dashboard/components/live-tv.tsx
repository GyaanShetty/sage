"use client";

/**
 * Live television, in the wall.
 *
 * The streams component has been in the tree for months rendering nowhere.
 * This is the same idea with the channels that belong on a markets desk, and
 * the one rule that makes a video panel usable on a dashboard: nothing plays
 * until you ask it to.
 *
 * Four autoplaying iframes is four video decoders, four audio contexts and a
 * couple of hundred megabytes of memory on a page that is open all day — and
 * the old build's version mounted them at `autoplay=1` on load. Here a channel
 * is a still frame with a play button until it is pressed, and only one plays
 * at a time, so the panel costs one decoder at most.
 */

import { useEffect, useState } from "react";
import { Pane } from "@/components/pane";
import { Play, X } from "lucide-react";
import { sound } from "@/lib/sound";

interface Channel { id: string; label: string; note: string }

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
  const [playing, setPlaying] = useState<string | null>(null);
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
  useEffect(() => {
    fetch(`/api/tv?ids=${CHANNELS.map((c) => c.id).join(",")}`, { signal: AbortSignal.timeout(20_000) })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setStills(j.data as Record<string, string>); })
      .catch(() => {});
  }, []);

  return (
    <Pane
      n={n}
      title="Live"
      status={playing ? CHANNELS.find((c) => c.id === playing)?.label : `${CHANNELS.length} channels`}
      live={!!playing}
    >
      {playing ? (
        <div className="tv-stage">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/live_stream?channel=${playing}&autoplay=1&mute=1`}
            title={CHANNELS.find((c) => c.id === playing)?.label ?? "Live"}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
          <button className="tv-close" onClick={() => { setPlaying(null); sound.detent(); }} aria-label="Stop">
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="tv-grid">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              className="tv-card"
              onClick={() => { setPlaying(c.id); sound.latch(true); }}
              onPointerEnter={() => sound.hover()}
            >
              {stills[c.id] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="tv-still" src={stills[c.id]} alt="" loading="lazy" />
              )}
              <span className="tv-shade" aria-hidden />
              <span className="tv-play"><Play className="size-3" /></span>
              <span className="tv-name">{c.label}</span>
              <span className="tv-note">{c.note}</span>
            </button>
          ))}
        </div>
      )}
    </Pane>
  );
}
