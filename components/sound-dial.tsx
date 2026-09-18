"use client";

import { useEffect, useState } from "react";
import { sound } from "@/lib/sound";

/**
 * Volume, and an audition button.
 *
 * On/off was the only control, which meant the choice was "machinery" or
 * "nothing". The dial reads from localStorage in an effect rather than during
 * render — the server has no localStorage, and seeding state from it directly
 * makes the first client render disagree with the markup React sent.
 */
export function SoundDial() {
  const [vol, setVol] = useState(0.75);
  const [on, setOn] = useState(true);

  useEffect(() => { setVol(sound.volume()); setOn(sound.isOn()); }, []);

  return (
    <div className="snd-dial">
      <div className="snd-row">
        <input
          type="range" min={0} max={100} value={Math.round(vol * 100)}
          aria-label="Interface volume" disabled={!on}
          onChange={(e) => { const v = Number(e.target.value) / 100; setVol(v); sound.setVolume(v); }}
        />
        <span className="snd-read">{on ? `${Math.round(vol * 100)}%` : "MUTED"}</span>
      </div>
      <div className="snd-demo">
        {([
          ["START-UP", () => sound.intro(6)],
          ["ALERT", () => sound.alert()],
          ["DONE", () => sound.success()],
          ["FAULT", () => sound.error()],
        ] as const).map(([label, play]) => (
          <button key={label} onClick={() => { setOn(sound.isOn()); play(); }} disabled={!on}>{label}</button>
        ))}
      </div>
    </div>
  );
}
