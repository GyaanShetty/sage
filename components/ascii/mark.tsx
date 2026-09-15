"use client";

/**
 * SAGE, in block glyphs, materialising.
 *
 * The wordmark is drawn in the ANSI-shadow style a terminal has used for
 * banners since before any of this was a website — which is the right
 * register for a screen that is already a Bloomberg pastiche, and it is the
 * "bold retro game" shape asked for without pretending to be a logo file.
 *
 * The animation is a decrypt: every cell starts as noise and resolves to its
 * final glyph, left to right with a slight per-row lag so the word assembles
 * rather than snapping on. After the last cell resolves it holds — a banner
 * that keeps churning is a distraction, not an identity.
 *
 * Rendered one string per row rather than a span per character: six text
 * nodes updated twelve times a second costs nothing, two hundred elements
 * would.
 */

import { noiseGlyph, useAsciiFrame } from "@/lib/ascii-clock";

/* Lines kept as data rather than a template literal so trailing spaces — which
   carry the shadow — survive every editor that trims them. */
const SAGE = [
  " ██████╗  █████╗   ██████╗ ███████╗",
  "██╔════╝ ██╔══██╗ ██╔════╝ ██╔════╝",
  "╚█████╗  ███████║ ██║  ██╗ █████╗  ",
  " ╚═══██╗ ██╔══██║ ██║  ╚██╗██╔══╝  ",
  "██████╔╝ ██║  ██║ ╚██████╔╝███████╗",
  "╚═════╝  ╚═╝  ╚═╝  ╚═════╝ ╚══════╝",
];

/** Cells resolve this many frames apart, left to right. */
const SPEED = 0.55;
/** Each row starts a little after the one above it. */
const ROW_LAG = 3;

export function AsciiMark({
  lines = SAGE,
  className,
  label = "SAGE",
}: { lines?: string[]; className?: string; label?: string }) {
  const frame = useAsciiFrame();

  const width = Math.max(...lines.map((l) => l.length));
  const done = width * SPEED + lines.length * ROW_LAG + 6;
  const settled = frame > done;

  return (
    <pre className={`ascii-mark${className ? ` ${className}` : ""}`} aria-label={label} role="img">
      {lines.map((line, row) => {
        if (settled) return `${line}\n`;
        const threshold = (frame - row * ROW_LAG) / SPEED;
        let out = "";
        for (let col = 0; col < line.length; col++) {
          const ch = line[col];
          // Spaces stay spaces: noise in the gaps turns a wordmark into a
          // rectangle of static and loses the letterforms entirely.
          out += ch === " " || col < threshold ? ch : noiseGlyph(row * 97 + col, frame);
        }
        return `${out}\n`;
      })}
    </pre>
  );
}

/**
 * The sigil as a small ASCII plate — for places a 200px mark will not fit.
 * Deliberately crude: at eleven columns, detail reads as dirt.
 */
const SIGIL = [
  "   ╱▔╲   ",
  "  ╱ ● ╲  ",
  " ╱╲ ┃ ╱╲ ",
  "▕  ╲┃╱  ▏",
  " ╲__▇__╱ ",
];

export function AsciiSigil({ className }: { className?: string }) {
  return <AsciiMark lines={SIGIL} className={className} label="SAGE mark" />;
}
