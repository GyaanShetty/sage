/**
 * A five-row block alphabet, drawn entirely with U+2588 FULL BLOCK.
 *
 * The first attempt at a block wordmark used ANSI Shadow, which mixes █ with
 * box-drawing pieces (╗ ╔ ═ ║). Those depend on the font joining them
 * seamlessly, and at small sizes with a glow they smeared into an unreadable
 * mass. A single repeated glyph has no such problem: every monospace font on
 * every platform draws █ as a filled cell, so the letters are solid at any
 * size, and the only thing controlling weight is how many cells you fill.
 *
 * Five rows is the smallest grid where every letter stays unambiguous — four
 * cannot separate B from R, or S from 5.
 */

const F = "█";
const _ = " ";

/** Each glyph is five equal-width rows. Widths vary per letter, like real type. */
const GLYPHS: Record<string, string[]> = {
  A: ["███", "█ █", "███", "█ █", "█ █"],
  B: ["██ ", "█ █", "██ ", "█ █", "██ "],
  C: ["███", "█  ", "█  ", "█  ", "███"],
  D: ["██ ", "█ █", "█ █", "█ █", "██ "],
  E: ["███", "█  ", "██ ", "█  ", "███"],
  F: ["███", "█  ", "██ ", "█  ", "█  "],
  G: ["███", "█  ", "█ █", "█ █", "███"],
  H: ["█ █", "█ █", "███", "█ █", "█ █"],
  I: ["███", " █ ", " █ ", " █ ", "███"],
  J: ["███", "  █", "  █", "█ █", "███"],
  K: ["█ █", "█ █", "██ ", "█ █", "█ █"],
  L: ["█  ", "█  ", "█  ", "█  ", "███"],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  O: ["███", "█ █", "█ █", "█ █", "███"],
  P: ["███", "█ █", "███", "█  ", "█  "],
  Q: ["███", "█ █", "█ █", "███", "  █"],
  R: ["███", "█ █", "██ ", "█ █", "█ █"],
  S: ["███", "█  ", "███", "  █", "███"],
  T: ["███", " █ ", " █ ", " █ ", " █ "],
  U: ["█ █", "█ █", "█ █", "█ █", "███"],
  V: ["█ █", "█ █", "█ █", "█ █", " █ "],
  W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
  X: ["█ █", "█ █", " █ ", "█ █", "█ █"],
  Y: ["█ █", "█ █", "███", " █ ", " █ "],
  Z: ["███", "  █", " █ ", "█  ", "███"],
  0: ["███", "█ █", "█ █", "█ █", "███"],
  1: [" █ ", "██ ", " █ ", " █ ", "███"],
  2: ["███", "  █", "███", "█  ", "███"],
  3: ["███", "  █", "███", "  █", "███"],
  4: ["█ █", "█ █", "███", "  █", "  █"],
  5: ["███", "█  ", "███", "  █", "███"],
  6: ["███", "█  ", "███", "█ █", "███"],
  7: ["███", "  █", " █ ", " █ ", " █ "],
  8: ["███", "█ █", "███", "█ █", "███"],
  9: ["███", "█ █", "███", "  █", "███"],
  ".": ["  ", "  ", "  ", "  ", "█ "],
  "-": ["   ", "   ", "███", "   ", "   "],
  "/": ["  █", "  █", " █ ", "█  ", "█  "],
  "&": ["██ ", "██ ", "███", "█ █", "███"],
  " ": ["  ", "  ", "  ", "  ", "  "],
};

/**
 * Render text as five lines of block art.
 *
 * Unknown characters are dropped rather than substituted — a box glyph in the
 * middle of a word looks like a bug, and silently omitting one looks like
 * kerning.
 */
export function asciiText(text: string, gap = 1): string {
  const chars = [...text.toUpperCase()].map((c) => GLYPHS[c]).filter(Boolean) as string[][];
  if (chars.length === 0) return "";
  const spacer = _.repeat(gap);
  return Array.from({ length: 5 }, (_row, r) => chars.map((g) => g[r]).join(spacer)).join("\n");
}

/** Width in character cells, for deciding whether a line will fit. */
export function asciiWidth(text: string, gap = 1): number {
  const chars = [...text.toUpperCase()].map((c) => GLYPHS[c]).filter(Boolean) as string[][];
  if (chars.length === 0) return 0;
  return chars.reduce((w, g) => w + g[0].length, 0) + gap * (chars.length - 1);
}

export const BLOCK = F;
