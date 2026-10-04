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

import { useState } from "react";
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
  { id: "UCupvZG-5ko_eiXAupbDfxWw", label: "CNN", note: "World" },
  { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", label: "Al Jazeera", note: "World" },
  { id: "UCknLrEdhRCp1aegoMqRaCZg", label: "DW News", note: "Europe" },
  { id: "UC16niRr50-MSBwiO3YDb3RA", label: "BBC News", note: "World" },
];

export function LiveTv({ n }: { n?: number }) {
  const [playing, setPlaying] = useState<string | null>(null);

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
