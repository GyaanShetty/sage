/**
 * Split text into speakable pieces at sentence boundaries.
 *
 * Never mid-word, and preferably never mid-sentence: a chunk boundary is
 * audible as a tiny gap, and a gap inside a clause sounds like a fault whereas
 * one between sentences sounds like breathing. A single sentence longer than
 * the limit is broken at a comma, and failing that at a space, because
 * returning something over the limit would simply be refused by the provider.
 */
export function splitForSpeech(text: string, limit: number): string[] {
  const clean = text.trim();
  if (clean.length <= limit) return clean ? [clean] : [];

  const sentences = clean.match(/[^.!?…]+[.!?…]+[\s]*|[^.!?…]+$/g) ?? [clean];
  const out: string[] = [];
  let cur = "";

  const hardSplit = (s: string) => {
    let rest = s;
    while (rest.length > limit) {
      const window = rest.slice(0, limit);
      const at = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(" "));
      const cut = at > limit * 0.5 ? at + 1 : limit;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
    return rest;
  };

  for (const raw of sentences) {
    const s = raw;
    if (s.trim().length > limit) {
      if (cur.trim()) { out.push(cur.trim()); cur = ""; }
      cur = hardSplit(s);
      continue;
    }
    if ((cur + s).length > limit) {
      if (cur.trim()) out.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

