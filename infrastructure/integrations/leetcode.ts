import { proxyFetch } from "@/infrastructure/http/fetch";

const GQL = "https://leetcode.com/graphql";

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await proxyFetch(GQL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; SAGE/0.2)",
        referer: "https://leetcode.com",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export interface DailyChallenge {
  date: string;
  link: string;
  title: string;
  titleSlug: string;
  difficulty: string;
}

/** LeetCode's daily coding challenge — no auth needed. */
export async function getDailyChallenge(): Promise<DailyChallenge | null> {
  const data = await gql<{
    activeDailyCodingChallengeQuestion?: {
      date: string;
      link: string;
      question: { title: string; titleSlug: string; difficulty: string };
    };
  }>(
    `query { activeDailyCodingChallengeQuestion { date link question { title titleSlug difficulty } } }`,
    {},
  );
  const d = data?.activeDailyCodingChallengeQuestion;
  if (!d) return null;
  return {
    date: d.date,
    link: `https://leetcode.com${d.link}`,
    title: d.question.title,
    titleSlug: d.question.titleSlug,
    difficulty: d.question.difficulty,
  };
}

export interface Problem {
  title: string;
  titleSlug: string;
  difficulty: string;
  /** The statement, as plain text. LeetCode returns HTML. */
  statement: string;
  hints: string[];
  topics: string[];
  /** Starter code per language, keyed by LeetCode's lang slug. */
  snippets: Record<string, string>;
  link: string;
}

/**
 * A problem's full statement.
 *
 * Public, no auth — the same query the website uses to render the page. The
 * statement arrives as HTML; it is flattened to text because it is displayed
 * in a plain block, and rendering someone else's markup live is a habit worth
 * not having.
 */
export async function getProblem(titleSlug: string): Promise<Problem | null> {
  const data = await gql<{
    question?: {
      title: string; titleSlug: string; difficulty: string; content: string;
      hints?: string[];
      topicTags?: { name: string }[];
      codeSnippets?: { langSlug: string; code: string }[];
    };
  }>(
    `query q($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title titleSlug difficulty content hints
        topicTags { name }
        codeSnippets { langSlug code }
      }
    }`,
    { titleSlug },
  );

  const q = data?.question;
  if (!q) return null;

  const statement = (q.content ?? "")
    .replace(/<sup>(\d+)<\/sup>/g, "^$1")      // 10<sup>4</sup> reads as 10^4
    .replace(/<\/(p|div|li|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    title: q.title,
    titleSlug: q.titleSlug,
    difficulty: q.difficulty,
    statement,
    hints: q.hints ?? [],
    topics: (q.topicTags ?? []).map((t) => t.name),
    snippets: Object.fromEntries((q.codeSnippets ?? []).map((c) => [c.langSlug, c.code])),
    link: `https://leetcode.com/problems/${q.titleSlug}/`,
  };
}

export interface ProblemSummary {
  title: string;
  titleSlug: string;
  difficulty: string;
  /** Percentage of submissions accepted — a rough proxy for how nasty it is. */
  acRate: number;
  paidOnly: boolean;
  topics: string[];
  /** LeetCode's own number, which is how everyone refers to these. */
  frontendId: string;
}

/**
 * Search the problem set.
 *
 * The same public query the website's problem list uses. Premium problems come
 * back in the results but are marked, because the statement behind them is not
 * fetchable without an account — better to show one greyed out than to have it
 * silently missing from a search he knows should match.
 *
 * A number typed instead of a name is handled by the caller: LeetCode's
 * `searchKeywords` matches titles, not IDs.
 */
interface RawQuestion {
  title: string; titleSlug: string; difficulty: string;
  acRate: number; paidOnly: boolean; frontendQuestionId: string;
  topicTags?: { name: string }[];
}

const FIELDS = `
  questions: data {
    title titleSlug difficulty acRate paidOnly frontendQuestionId
    topicTags { name }
  }
`;

/**
 * LeetCode has renamed this endpoint before.
 *
 * `questionList` is the long-standing name and `problemsetQuestionList` is the
 * newer one; which answers depends on the day. Rather than pick one and have
 * search quietly return nothing the next time they swap, try both — the second
 * costs a round trip only when the first has already failed.
 */
async function questionPage(
  limit: number,
  skip: number,
  filters: Record<string, unknown>,
): Promise<RawQuestion[]> {
  const vars = { categorySlug: "", limit, skip, filters };

  for (const field of ["problemsetQuestionList", "questionList"] as const) {
    const data = await gql<Record<string, { questions: RawQuestion[] } | undefined>>(
      `query list($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
        page: ${field}(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
          ${FIELDS}
        }
      }`,
      vars,
    );
    const page = data?.page;
    if (page?.questions?.length) return page.questions;
  }
  return [];
}

export async function searchProblems(
  keyword: string,
  opts: { difficulty?: "EASY" | "MEDIUM" | "HARD"; topic?: string; limit?: number } = {},
): Promise<ProblemSummary[]> {
  const filters: Record<string, unknown> = {};
  if (keyword.trim()) filters.searchKeywords = keyword.trim().slice(0, 80);
  if (opts.difficulty) filters.difficulty = opts.difficulty;
  if (opts.topic) filters.tags = [opts.topic];

  const questions = await questionPage(Math.min(50, opts.limit ?? 25), 0, filters);
  return questions.map(toSummary);
}

function toSummary(q: RawQuestion): ProblemSummary {
  return {
    title: q.title,
    titleSlug: q.titleSlug,
    difficulty: q.difficulty,
    acRate: Math.round((q.acRate ?? 0) * 10) / 10,
    paidOnly: !!q.paidOnly,
    topics: (q.topicTags ?? []).map((t) => t.name),
    frontendId: q.frontendQuestionId,
  };
}

/**
 * Find a problem by its number.
 *
 * Searching "1" by keyword returns everything with a 1 in the title and not
 * Two Sum, so a numeric query is resolved by pulling a page of the problem set
 * and matching the id exactly. Slower than a lookup would be, but LeetCode
 * does not expose one.
 */
export async function problemByNumber(id: number): Promise<ProblemSummary | null> {
  const wanted = String(id);
  // The list is ordered by id, so the page holding it is predictable — but
  // premium-only and retired problems make the alignment drift, so the window
  // is wide and widened once before giving up.
  for (const [skip, limit] of [[Math.max(0, id - 25), 60], [Math.max(0, id - 120), 250]] as const) {
    const hit = (await questionPage(limit, skip, {})).find((q) => q.frontendQuestionId === wanted);
    if (hit) return toSummary(hit);
  }
  return null;
}

export interface LeetStats {
  username: string;
  ranking: number | null;
  solved: { all: number; easy: number; medium: number; hard: number };
  streak: number;
  totalActiveDays: number;
  todaySolved: number;
  /** day (YYYY-MM-DD) → submissions, for the activity heatmap. */
  calendar: Record<string, number>;
}

/** Public profile stats + streak for a username (no auth). */
export async function getLeetStats(username: string): Promise<LeetStats | null> {
  if (!username) return null;
  const data = await gql<{
    matchedUser?: {
      profile?: { ranking?: number };
      submitStats?: { acSubmissionNum?: { difficulty: string; count: number }[] };
      userCalendar?: { streak?: number; totalActiveDays?: number; submissionCalendar?: string };
    };
  }>(
    `query($u:String!){ matchedUser(username:$u){ profile{ ranking } submitStats{ acSubmissionNum{ difficulty count } } userCalendar{ streak totalActiveDays submissionCalendar } } }`,
    { u: username },
  );
  const m = data?.matchedUser;
  if (!m) return null;
  const nums = m.submitStats?.acSubmissionNum ?? [];
  const by = (d: string) => nums.find((n) => n.difficulty === d)?.count ?? 0;

  // today's solved count + a day→count map for the heatmap (epoch-second keys).
  let todaySolved = 0;
  const calendar: Record<string, number> = {};
  try {
    const cal = JSON.parse(m.userCalendar?.submissionCalendar ?? "{}") as Record<string, number>;
    // LeetCode buckets its calendar by UTC day, so "today" has to mean the
    // same thing or the count disagrees with the heatmap beside it.
    // setHours() would have used the server's local midnight — UTC on Vercel,
    // IST in development, which is how this read differently in the two places.
    const now = new Date();
    const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
    for (const [ts, count] of Object.entries(cal)) {
      if (Number(ts) >= startOfDay) todaySolved += count;
      const day = new Date(Number(ts) * 1000).toISOString().slice(0, 10);
      calendar[day] = (calendar[day] ?? 0) + count;
    }
  } catch {
    /* ignore */
  }

  return {
    username,
    ranking: m.profile?.ranking ?? null,
    solved: { all: by("All"), easy: by("Easy"), medium: by("Medium"), hard: by("Hard") },
    streak: m.userCalendar?.streak ?? 0,
    totalActiveDays: m.userCalendar?.totalActiveDays ?? 0,
    todaySolved,
    calendar,
  };
}
