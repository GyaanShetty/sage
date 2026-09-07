/**
 * What is on the screen, in words.
 *
 * "It should read from every page" — so a voice turn has to carry the page
 * with it. Two things are needed and neither is guessable server-side: which
 * route he is looking at, and what that route is currently showing, which for
 * a live wall changes every few seconds.
 *
 * Read from the DOM rather than from application state on purpose. There is no
 * single store holding what every page renders, and there never will be while
 * each feature fetches its own data — but the rendered text is the one place
 * all of it has already met, and it is by definition exactly what he can see
 * while he is asking about it.
 *
 * Nothing here is sent unless a turn is taken, and it is a snapshot at that
 * moment: no watching, no polling, no background reading of the screen.
 */

/** Tiles carry titles; this is the text the titles label. */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS"]);

/** Panes first, then anything the page rendered outside one. */
const PANE = ".pane, .cc-opp, .sectitle, main h1, main h2";

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The visible text of one element, capped.
 *
 * Hidden elements are excluded because a tab that is not showing is not what
 * he is looking at — reading it back would have SAGE describing a screen he
 * cannot see, which is worse than saying nothing.
 */
export function visibleText(el: Element, max = 240): string {
  if (SKIP.has(el.tagName)) return "";
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return "";
  return clean((el as HTMLElement).innerText ?? el.textContent ?? "").slice(0, max);
}

/** A route path as the name SAGE would say. */
export function pageName(path: string): string {
  const seg = path.split("?")[0].split("/").filter(Boolean).pop();
  if (!seg) return "Mission Control";
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface PageContext {
  path: string;
  name: string;
  /** One line per pane, in the order they are on screen. */
  panes: string[];
}

/**
 * Snapshot the current page. Returns null outside the browser, so callers can
 * pass it straight through on the server without a guard.
 */
export function capturePage(limit = 24): PageContext | null {
  if (typeof document === "undefined") return null;
  const panes = Array.from(document.querySelectorAll(PANE))
    .map((el) => visibleText(el))
    .filter((t) => t.length > 2)
    .slice(0, limit);
  const path = window.location.pathname;
  return { path, name: pageName(path), panes };
}

/** The block a voice turn puts in front of the model. Empty when there is nothing. */
export function describePage(ctx: PageContext | null | undefined): string {
  if (!ctx || ctx.panes.length === 0) return "";
  return (
    `\n\nHe is looking at the ${ctx.name} screen (${ctx.path}) right now. ` +
    "Read it back to him when he asks what is on screen, and use it in preference to a tool when it already answers him:\n" +
    ctx.panes.map((p) => `- ${p}`).join("\n")
  );
}
