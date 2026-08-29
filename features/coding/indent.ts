/**
 * Editor indentation, as a pure function.
 *
 * Tab already inserted four spaces, which is the easy third of the problem.
 * The parts that actually make a textarea feel like an editor are the other
 * two: pressing Enter should keep you where you were, and Tab on a selection
 * should move the whole block rather than replacing it with a tab character —
 * which is the single most destructive default a plain textarea has, because
 * it silently deletes the code you had highlighted.
 *
 * Written as pure text-in/text-out so the awkward cases can be tested without
 * a browser: they are all off-by-one bugs on the caret, and every one of them
 * looks like "the editor is broken" rather than like an indentation rule.
 */

export interface EditState { value: string; start: number; end: number }

const UNIT = "    ";

/** Leading whitespace of the line containing `pos`. */
function indentAt(value: string, pos: number): string {
  const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
  return /^[ \t]*/.exec(value.slice(lineStart, pos))?.[0] ?? "";
}

/** Does this line open a block? Covers Python's colon and C-family braces. */
function opensBlock(line: string): boolean {
  const t = line.trim();
  return /[:{[(]$/.test(t);
}

/** Does this line close one — a `}` typed on its own, or a dedenting keyword? */
function closesBlock(line: string): boolean {
  const t = line.trim();
  return /^[}\])]/.test(t) || /^(return|break|continue|pass|raise)\b/.test(t);
}

/**
 * Enter: carry the current indentation, and add a level after a line that
 * opens a block.
 *
 * Losing your indentation on every newline is what makes writing Python in a
 * plain textarea genuinely painful, since the indentation *is* the syntax.
 */
export function onEnter(s: EditState): EditState {
  const lineStart = s.value.lastIndexOf("\n", s.start - 1) + 1;
  const line = s.value.slice(lineStart, s.start);
  const indent = indentAt(s.value, s.start) + (opensBlock(line) ? UNIT : "");
  const insert = `\n${indent}`;
  return {
    value: s.value.slice(0, s.start) + insert + s.value.slice(s.end),
    start: s.start + insert.length,
    end: s.start + insert.length,
  };
}

/** Line bounds covering the whole selection, so block ops move every line. */
function selectedLines(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  let to = value.indexOf("\n", end);
  if (to === -1) to = value.length;
  return { from, to };
}

/**
 * Tab. With a selection this indents every line in it; with none it inserts
 * one unit at the caret.
 *
 * The selection case is the one that matters: a plain textarea replaces the
 * selection with a tab character, destroying it.
 */
export function onTab(s: EditState): EditState {
  if (s.start === s.end) {
    return {
      value: s.value.slice(0, s.start) + UNIT + s.value.slice(s.end),
      start: s.start + UNIT.length,
      end: s.start + UNIT.length,
    };
  }
  const { from, to } = selectedLines(s.value, s.start, s.end);
  const block = s.value.slice(from, to);
  const shifted = block.split("\n").map((l) => UNIT + l).join("\n");
  return {
    value: s.value.slice(0, from) + shifted + s.value.slice(to),
    start: s.start + UNIT.length,
    end: s.end + (shifted.length - block.length),
  };
}

/**
 * Shift+Tab: remove up to one unit from each selected line, or from the
 * current line when there is no selection.
 *
 * "Up to": a line indented by two spaces loses two, not four, and a line with
 * none is left alone rather than eating the first characters of the code.
 */
export function onShiftTab(s: EditState): EditState {
  const { from, to } = selectedLines(s.value, s.start, s.end);
  const block = s.value.slice(from, to);

  let firstRemoved = 0;
  let totalRemoved = 0;
  const shifted = block.split("\n").map((l, i) => {
    const lead = /^[ \t]{1,4}/.exec(l)?.[0] ?? "";
    if (i === 0) firstRemoved = lead.length;
    totalRemoved += lead.length;
    return l.slice(lead.length);
  }).join("\n");

  return {
    value: s.value.slice(0, from) + shifted + s.value.slice(to),
    // Never drag the caret behind the start of its own line.
    start: Math.max(from, s.start - firstRemoved),
    end: Math.max(from, s.end - totalRemoved),
  };
}

/**
 * Typing a closing bracket on an otherwise blank line pulls it back one level,
 * so a block closes where it opened instead of floating inside itself.
 */
export function onCloseBracket(s: EditState, ch: string): EditState | null {
  if (!/^[}\])]$/.test(ch)) return null;
  const lineStart = s.value.lastIndexOf("\n", s.start - 1) + 1;
  const before = s.value.slice(lineStart, s.start);
  if (before.trim() !== "") return null;           // not the first thing on the line
  if (!before.startsWith(UNIT)) return null;       // already at the left margin

  const outdented = before.slice(UNIT.length);
  return {
    value: s.value.slice(0, lineStart) + outdented + ch + s.value.slice(s.end),
    start: lineStart + outdented.length + 1,
    end: lineStart + outdented.length + 1,
  };
}

export { closesBlock };
