/**
 * HTML entities, decoded once at the boundary where text arrives.
 *
 * Mail previews come out of Gmail and Graph as HTML fragments, so an
 * apostrophe arrives as &#39; and an ampersand as &amp;. Nothing decoded them,
 * which is why the morning brief read "You&#39;re receiving this" and
 * "Here&#39;s Subash Hegde&#39;s new photo" — visible machinery in a sentence
 * SAGE reads aloud.
 *
 * Decoding belongs where the data enters rather than where it is displayed:
 * the same preview reaches the brief, the inbox pane, the triage model and
 * the voice reply, and four decoders is three too many — the one that gets
 * forgotten is the one you notice.
 *
 * Order matters at the end: decoding &amp; before the others turns a literal
 * "&amp;lt;" into "<", which is a different string from the one that was sent.
 */

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  hellip: "…", mdash: "—", ndash: "–", middot: "·",
  eacute: "é", egrave: "è", uuml: "ü", ouml: "ö", auml: "ä",
  copy: "©", reg: "®", trade: "™", deg: "°", euro: "€", pound: "£",
  le: "<=", ge: ">=", ne: "!=", times: "x", minus: "-", bull: "•",
  zwnj: "", zwj: "", shy: "",
};

export function decodeEntities(input: string): string {
  if (!input || !input.includes("&")) return input ?? "";

  return input
    // Numeric, decimal and hex: &#8217; and &#x2019; are both a right quote.
    .replace(/&#(\d{1,7});/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&([a-z][a-z0-9]{1,9});/gi, (whole, name: string) => {
      const hit = NAMED[name.toLowerCase()];
      // An unknown entity is left exactly as it came: inventing a character
      // for it would be a silent edit to someone's words.
      return hit === undefined ? whole : hit;
    });
}

/** Out-of-range code points would throw or produce replacement junk. */
function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return "";
  try { return String.fromCodePoint(code); } catch { return ""; }
}

/** Entity-decoded, tags stripped, whitespace collapsed — for previews. */
export function plainText(input: string): string {
  return decodeEntities((input ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
