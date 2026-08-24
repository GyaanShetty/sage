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


/**
 * How much speech fits comfortably in one go.
 *
 * Neural TTS lands around 150 words a minute, and English averages roughly
 * 5.7 characters a word including the space — so a minute of speech is about
 * 850 characters. That is the unit SAGE speaks in.
 *
 * The ceiling is not really the audio buffer or the function timeout; both of
 * those are now handled. It is that a five-minute uninterrupted monologue is
 * a bad way to be told anything. Stopping at a minute and offering the rest
 * respects that better than technically being able to continue.
 */
export const SPOKEN_BUDGET_CHARS = 850;

/**
 * How much text one /api/voice/speak request synthesises.
 *
 * Shared because both sides need it: the route splits by it, and the client
 * needs the same split to work out what is left when a continuation request
 * fails partway through a long answer.
 */
export const SPEAK_CHUNK_CHARS = 1200;

/**
 * Break a long answer into speakable parts at sentence boundaries.
 *
 * Distinct from splitForSpeech, which chops a single utterance into provider-
 * sized requests that play back to back as one continuous take. These are
 * separate takes, each ending on a full stop, with a pause and a decision
 * between them.
 */
export function splitIntoParts(text: string, budget = SPOKEN_BUDGET_CHARS): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= budget) return [clean];

  // Slightly generous: a part that would otherwise strand a short tail reads
  // better finished than followed by ten seconds of epilogue.
  return splitForSpeech(clean, budget);
}

/** What SAGE says at the end of a part when there is more waiting. */
export function handoffLine(partIndex: number, total: number): string {
  const left = total - partIndex - 1;
  if (left <= 0) return "";
  return partIndex === 0
    ? `That's the first of ${total} parts, sir. Say "go on" for the rest.`
    : left === 1
      ? "One part left, sir — say \"go on\"."
      : `${left} parts left, sir — say "go on".`;
}
