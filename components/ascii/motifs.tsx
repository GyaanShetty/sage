"use client";

/**
 * The small animated pieces: spinners, meters, waves, rain.
 *
 * All of them take their frame from the one shared clock, so adding a
 * hundred of them to the wall costs one interval. All of them are aria-hidden
 * or labelled at the call site — a screen reader reading "⠋⠙⠹" aloud is
 * worse than silence.
 */

import { useAsciiFrame } from "@/lib/ascii-clock";

/** Braille spinner: the densest single-cell motion available in a font. */
const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function AsciiSpinner({ className }: { className?: string }) {
  const frame = useAsciiFrame();
  return <span className={`asc-spin${className ? ` ${className}` : ""}`} aria-hidden>{BRAILLE[frame % BRAILLE.length]}</span>;
}

/**
 * A scanning sweep, in characters.
 *
 * Indeterminate on purpose — nothing here knows how far along a fetch is, and
 * a bar that advances on a timer unrelated to the thing it measures teaches
 * you to stop believing the instrument.
 */
export function AsciiScan({ width = 22, className }: { width?: number; className?: string }) {
  const frame = useAsciiFrame();
  const head = frame % (width + 8);
  let out = "";
  for (let i = 0; i < width; i++) {
    const d = head - i;
    out += d === 0 ? "█" : d === 1 ? "▓" : d === 2 ? "▒" : d === 3 ? "░" : "·";
  }
  return <span className={`asc-scan${className ? ` ${className}` : ""}`} aria-hidden>{out}</span>;
}

/**
 * A determinate meter, for the things that genuinely know their fraction —
 * a syllabus, a budget, a target. Same alphabet as the sweep so the two read
 * as the same family, and the distinction between "indeterminate" and "this
 * is 40%" stays visible.
 */
export function AsciiMeter({ value, width = 16, className }: { value: number; width?: number; className?: string }) {
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return (
    <span className={`asc-meter${className ? ` ${className}` : ""}`} aria-hidden>
      {"█".repeat(filled)}{"░".repeat(width - filled)}
    </span>
  );
}

/** A slow sine of block glyphs — the idle "receiving" motif. */
const WAVE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export function AsciiWave({ width = 14, className }: { width?: number; className?: string }) {
  const frame = useAsciiFrame();
  let out = "";
  for (let i = 0; i < width; i++) {
    const v = (Math.sin((i + frame * 0.6) * 0.5) + 1) / 2;
    out += WAVE[Math.min(WAVE.length - 1, Math.floor(v * WAVE.length))];
  }
  return <span className={`asc-wave${className ? ` ${className}` : ""}`} aria-hidden>{out}</span>;
}

/**
 * Falling glyph rain, for a large empty area that would otherwise be a void.
 *
 * Deterministic per column, so it does not reshuffle between paints, and
 * sparse by default — this is texture behind content, not a screensaver in
 * front of it.
 */
const RAIN = "01│╱╲▒░▓█◆◇·";

export function AsciiRain({
  cols = 40, rows = 8, density = 0.22, className,
}: { cols?: number; rows?: number; density?: number; className?: string }) {
  const frame = useAsciiFrame();
  const lines: string[] = [];

  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      // Each column falls at its own speed; the head is bright, the tail fades
      // out by simply not being drawn.
      const speed = 1 + (c % 5) * 0.4;
      const head = Math.floor((frame * 0.35 * speed + c * 3) % (rows + 6));
      const within = head - r;
      const seeded = Math.abs(Math.imul(c * 374761393 + r * 668265263, 1274126177)) % 1000 / 1000;
      line += within >= 0 && within < 3 && seeded < density
        ? RAIN[(c + r + frame) % RAIN.length]
        : " ";
    }
    lines.push(line);
  }

  return <pre className={`asc-rain${className ? ` ${className}` : ""}`} aria-hidden>{lines.join("\n")}</pre>;
}
