"use client";

import { HUE_DEFAULT, HUE_PRESETS, useHue } from "@/lib/hue";

/**
 * The accent dial.
 *
 * Every red on the screen is one hue token, so this retunes the whole
 * instrument at once rather than theming a component at a time. The swatches
 * are the answer for people who want a colour; the slider is for people who
 * want THEIR colour.
 */
export function HueDial({ compact }: { compact?: boolean }) {
  const [hue, setHue] = useHue();
  const named = HUE_PRESETS.find((p) => Math.abs(p.h - hue) <= 3);

  return (
    <div className={`hue-dial${compact ? " is-compact" : ""}`}>
      <div className="hue-row" role="group" aria-label="Accent colour presets">
        {HUE_PRESETS.map((p) => (
          <button
            key={p.h}
            className={`hue-sw${Math.abs(p.h - hue) <= 3 ? " on" : ""}`}
            style={{ background: `hsl(${p.h} 100% 59%)` }}
            onClick={() => setHue(p.h)}
            title={p.name}
            aria-label={p.name}
            aria-pressed={Math.abs(p.h - hue) <= 3}
          />
        ))}
      </div>

      <div className="hue-fine">
        <input
          type="range"
          min={0}
          max={359}
          value={hue}
          aria-label="Accent hue"
          onChange={(e) => setHue(Number(e.target.value))}
        />
        <span className="hue-read">
          {named ? named.name.toUpperCase() : `H ${String(hue).padStart(3, "0")}`}
        </span>
        <button
          className="hue-reset"
          onClick={() => setHue(HUE_DEFAULT)}
          disabled={hue === HUE_DEFAULT}
          title="Back to signal red"
        >
          RESET
        </button>
      </div>
    </div>
  );
}
