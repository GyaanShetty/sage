import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { tzDay } from "@/lib/config";

/**
 * Semantic drift: how his attention has moved.
 *
 * Nobody notices their own drift. The thing you thought about constantly in
 * March simply stops coming up, and because it stopped gradually there is no
 * moment where you notice it went. It is visible in the data, though — SAGE
 * has been storing what he talks about for months, with timestamps.
 *
 * The method is deliberately dull: group memories by month, count the terms
 * that distinguish each month from the rest, and diff consecutive months. No
 * clustering, no embeddings, no model — this needs to be reproducible and
 * cheap, and a model asked "how has he changed" will always find a change,
 * which is the one failure mode that would make this worthless.
 */

export interface MonthTheme {
  /** "YYYY-MM". */
  month: string;
  count: number;
  /** Terms that distinguish this month from every other, strongest first. */
  themes: { term: string; score: number; n: number }[];
}

export interface Drift {
  months: MonthTheme[];
  /** Themes present now that were absent before. */
  emerged: string[];
  /** Themes that used to be constant and have gone quiet. */
  faded: string[];
  /** Themes present throughout — the things that are actually him. */
  constant: string[];
  notes: string[];
}

/**
 * Words too common to distinguish anything.
 *
 * Domain words go in here too — "gyaan", "sage", "wants" — because a term that
 * appears in every month by construction tells you nothing about any of them.
 */
const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "his", "her", "their", "from", "into",
  "about", "have", "has", "had", "was", "were", "been", "being", "are", "is", "it",
  "he", "she", "they", "you", "your", "his", "him", "them", "will", "would", "should",
  "can", "could", "not", "but", "than", "then", "when", "what", "which", "who", "how",
  "gyaan", "sage", "user", "wants", "likes", "prefers", "said", "says", "sir", "one",
  "also", "more", "most", "some", "any", "all", "out", "get", "got", "make", "made",
  "day", "days", "week", "time", "thing", "things", "work", "working", "new", "just",
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.replace(/^[.]+|[.]+$/g, ""))
    .filter((w) => w.length > 3 && w.length < 24 && !STOP.has(w) && !/^\d+$/.test(w));
}

/**
 * Score each month's terms by how much they belong to *that* month.
 *
 * A plain frequency count returns the same words every month — the words he
 * always uses. This is a term-frequency against document-frequency across
 * months, so a word only scores when it is concentrated in one place. The
 * effect is that "recursion" in the month he was stuck on trees beats
 * "college", which he says constantly.
 */
export function themesByMonth(
  entries: { at: string; text: string }[],
  perMonth = 6,
): MonthTheme[] {
  const byMonth = new Map<string, string[]>();
  for (const e of entries) {
    const month = tzDay(e.at).slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(e.text);
  }
  if (byMonth.size === 0) return [];

  // How many months each term appears in at all.
  const monthsWithTerm = new Map<string, number>();
  const perMonthCounts = new Map<string, Map<string, number>>();

  for (const [month, texts] of byMonth) {
    const counts = new Map<string, number>();
    for (const text of texts) for (const t of terms(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    perMonthCounts.set(month, counts);
    for (const t of counts.keys()) monthsWithTerm.set(t, (monthsWithTerm.get(t) ?? 0) + 1);
  }

  const totalMonths = byMonth.size;

  /**
   * A term in *every* month is a constant, not a theme.
   *
   * The tf-idf weighting demotes these but does not remove them, and with a
   * handful of distinct terms in a month a demoted word still makes the top
   * six — so "college", which he says constantly, appeared as a finding about
   * March. Constants are real and worth reporting; they just belong in their
   * own list rather than crowding out what changed.
   */
  const ubiquitous = new Set(
    totalMonths >= 3
      ? [...monthsWithTerm.entries()].filter(([, n]) => n === totalMonths).map(([t]) => t)
      : [],
  );

  return [...perMonthCounts.entries()]
    .map(([month, counts]) => {
      const total = [...counts.values()].reduce((a, n) => a + n, 0) || 1;
      const themes = [...counts.entries()]
        // A term seen once in a month is noise, not a theme.
        .filter(([term, n]) => n >= 2 && !ubiquitous.has(term))
        .map(([term, n]) => ({
          term,
          n,
          // tf × idf, with idf over months rather than documents.
          score: (n / total) * Math.log(totalMonths / (monthsWithTerm.get(term) ?? 1) + 1),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, perMonth)
        .map((t) => ({ term: t.term, score: Number(t.score.toFixed(4)), n: t.n }));

      return { month, count: byMonth.get(month)!.length, themes };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Terms present in every month of the window — what is actually him. */
export function constantTerms(entries: { at: string; text: string }[]): string[] {
  const byMonth = new Map<string, Set<string>>();
  for (const e of entries) {
    const month = tzDay(e.at).slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, new Set());
    for (const t of terms(e.text)) byMonth.get(month)!.add(t);
  }
  if (byMonth.size < 3) return [];

  const seen = new Map<string, number>();
  for (const set of byMonth.values()) for (const t of set) seen.set(t, (seen.get(t) ?? 0) + 1);

  return [...seen.entries()]
    .filter(([, n]) => n === byMonth.size)
    .map(([t]) => t)
    .slice(0, 8);
}

/**
 * What emerged, what faded, what stayed.
 *
 * "Recent" is the last two months and "before" is everything earlier, because
 * a month-on-month diff of a student's life is mostly noise about which module
 * they happened to have that fortnight.
 */
export function diffThemes(months: MonthTheme[]): Pick<Drift, "emerged" | "faded" | "constant" | "notes"> {
  if (months.length < 3) {
    return {
      emerged: [], faded: [], constant: [],
      notes: [`Only ${months.length} month${months.length === 1 ? "" : "s"} of history — drift needs at least three to mean anything.`],
    };
  }

  const recent = months.slice(-2);
  const before = months.slice(0, -2);

  const setOf = (ms: MonthTheme[]) => new Set(ms.flatMap((m) => m.themes.map((t) => t.term)));
  const recentTerms = setOf(recent);
  const beforeTerms = setOf(before);

  const emerged = [...recentTerms].filter((t) => !beforeTerms.has(t));
  const faded = [...beforeTerms].filter((t) => !recentTerms.has(t));

  // Present in most months, not merely in both halves — that is what makes it
  // a constant rather than a coincidence.
  const appearances = new Map<string, number>();
  for (const m of months) for (const t of m.themes) appearances.set(t.term, (appearances.get(t.term) ?? 0) + 1);
  const constant = [...appearances.entries()]
    .filter(([, n]) => n >= Math.ceil(months.length * 0.6))
    .map(([t]) => t);

  const notes: string[] = [];
  if (emerged.length) notes.push(`Newly on your mind: ${emerged.slice(0, 5).join(", ")}.`);
  if (faded.length) notes.push(`Gone quiet: ${faded.slice(0, 5).join(", ")} — you talked about these and have not lately.`);
  if (constant.length) notes.push(`Constant throughout: ${constant.slice(0, 5).join(", ")}.`);
  if (!emerged.length && !faded.length) notes.push("Your attention has been steady across the window.");

  return { emerged: emerged.slice(0, 12), faded: faded.slice(0, 12), constant: constant.slice(0, 8), notes };
}

/** Read it from his actual memories and journal entries. */
export async function drift(): Promise<Drift> {
  const [{ data: memories }, { data: logs }] = await Promise.all([
    db.from("Memory").select("content, createdAt")
      .eq("userId", DEFAULT_USER_ID).is("supersededBy", null)
      .order("createdAt", { ascending: true }).limit(2000),
    db.from("Event").select("payload, createdAt")
      .eq("userId", DEFAULT_USER_ID).eq("type", "education.log")
      .order("createdAt", { ascending: true }).limit(1000),
  ]);

  const entries = [
    ...(memories ?? []).map((m) => ({ at: m.createdAt as string, text: String(m.content ?? "") })),
    ...(logs ?? []).map((l) => ({
      at: l.createdAt as string,
      text: String((l.payload as { text?: string })?.text ?? ""),
    })),
  ].filter((e) => e.text.trim().length > 8);

  const months = themesByMonth(entries);
  const diff = diffThemes(months);
  // Constants are computed over the raw entries rather than the themes, since
  // themesByMonth now excludes them by design.
  const constant = constantTerms(entries);
  const notes = constant.length
    ? [...diff.notes.filter((n) => !/^Constant throughout/.test(n)), `Constant throughout: ${constant.slice(0, 5).join(", ")}.`]
    : diff.notes;

  return { months, ...diff, constant, notes };
}
