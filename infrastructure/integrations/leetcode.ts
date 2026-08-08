import { proxyFetch } from "@/infrastructure/http/fetch";

const GQL = "https://leetcode.com/graphql";

/**
 * The last thing LeetCode said when a query failed.
 *
 * GraphQL answers a malformed query with HTTP 200 and an `errors` array, which
 * this used to discard entirely — so "unknown field" and "the network is down"
 * were indistinguishable from the outside, and a schema change could only be
 * diagnosed by someone who could reach the API themselves. Now the message is
 * kept so a caller can surface it.
 */
let lastGqlError: string | null = null;

export function lastLeetcodeError(): string | null {
  return lastGqlError;
}

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
    if (!res.ok) {
      lastGqlError = `HTTP ${res.status}`;
      return null;
    }
    const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (json.errors?.length) {
      lastGqlError = json.errors.map((e) => e.message).filter(Boolean).join("; ").slice(0, 300);
      return null;
    }
    lastGqlError = null;
    return json.data ?? null;
  } catch (e) {
    lastGqlError = (e as Error).message?.slice(0, 200) ?? "request failed";
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

interface RawQuestion {
  title: string; titleSlug: string; difficulty: string;
  acRate: number; paidOnly: boolean; frontendQuestionId: string;
  topicTags?: { name: string }[];
}

const FIELDS = `
  questions: data {
    title titleSlug difficulty acRate paidOnly
    frontendQuestionId: questionFrontendId
    topicTags { name }
  }
`;

/**
 * The problem list, whichever shape LeetCode is serving today.
 *
 * They have rewritten this endpoint more than once and the variants are not
 * compatible: the field is named differently, the search term moved from
 * inside `filters` to its own variable, the rows moved from `data` to
 * `questions`, and the id is `questionFrontendId` in one and
 * `frontendQuestionId` in another. Picking one and hoping is how the picker
 * shipped broken.
 *
 * So each known shape is tried in turn, newest first, and the first that
 * answers wins. A wrong guess costs one round trip and returns a GraphQL error
 * rather than doing damage, which makes this cheap to be wrong about — and the
 * error is kept, so if all of them fail the message says what LeetCode
 * actually objected to instead of "something went wrong".
 */
async function questionPage(
  limit: number,
  skip: number,
  filters: Record<string, unknown>,
): Promise<RawQuestion[] | null> {
  const { searchKeywords, difficulty, tags } = filters as {
    searchKeywords?: string; difficulty?: string; tags?: string[];
  };
  const errors: string[] = [];

  /**
   * V2 does not take the old filter object.
   *
   * Difficulty became a list and the search term moved out entirely, so
   * forwarding the legacy shape would fail on a type error even when the
   * endpoint itself is the right one — the worst kind of near miss. Anything
   * not understood here is simply left off: a slightly broader result set is
   * better than no result set.
   */
  const v2Filters: Record<string, unknown> = {};
  if (difficulty) v2Filters.difficultyList = [difficulty];
  if (tags?.length) v2Filters.topicSlugs = tags;

  // ── shape 1: problemsetQuestionListV2, the current one ───────────────────
  // Search is its own variable here, and the filter input has a new type name.
  const v2 = await gql<{ page?: { questions: RawQuestion[] } }>(
    `query v2($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionFilterInput, $searchKeyword: String) {
      page: problemsetQuestionListV2(
        categorySlug: $categorySlug, limit: $limit, skip: $skip,
        filters: $filters, searchKeyword: $searchKeyword
      ) {
        questions {
          title titleSlug difficulty acRate paidOnly
          frontendQuestionId: questionFrontendId
          topicTags { name }
        }
      }
    }`,
    { categorySlug: "", limit, skip, filters: v2Filters, searchKeyword: searchKeywords ?? "" },
  );
  if (Array.isArray(v2?.page?.questions)) return v2.page.questions;
  if (lastGqlError) errors.push(`v2: ${lastGqlError}`);

  // ── shape 2 and 3: the older list, under either name ─────────────────────
  for (const field of ["problemsetQuestionList", "questionList"] as const) {
    const data = await gql<Record<string, { questions: RawQuestion[] } | undefined>>(
      `query list($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
        page: ${field}(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
          ${FIELDS}
        }
      }`,
      { categorySlug: "", limit, skip, filters },
    );
    // An answered query with an empty list is a real "no matches" and must not
    // send us on to try the next shape.
    if (Array.isArray(data?.page?.questions)) return data.page.questions;
    if (lastGqlError) errors.push(`${field}: ${lastGqlError}`);
  }

  // ── last resort: V2 with nothing but the search term ─────────────────────
  // If the filter input is what it objected to, this still answers, and a
  // slightly unfiltered list beats an empty picker.
  if (Object.keys(v2Filters).length > 0) {
    const bare = await gql<{ page?: { questions: RawQuestion[] } }>(
      `query bare($limit: Int, $skip: Int, $searchKeyword: String) {
        page: problemsetQuestionListV2(limit: $limit, skip: $skip, searchKeyword: $searchKeyword) {
          questions {
            title titleSlug difficulty acRate paidOnly
            frontendQuestionId: questionFrontendId
            topicTags { name }
          }
        }
      }`,
      { limit, skip, searchKeyword: searchKeywords ?? "" },
    );
    if (Array.isArray(bare?.page?.questions)) return bare.page.questions;
    if (lastGqlError) errors.push(`v2-bare: ${lastGqlError}`);
  }

  // Every shape failed. Keep what each one said — that is the whole diagnosis.
  lastGqlError = errors.join(" | ").slice(0, 400) || "no response";

  // Null, not an empty array. "LeetCode did not answer" and "nothing matched
  // your search" are different facts, and showing the second when the first is
  // true is how a broken integration goes unnoticed for a month.
  return null;
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
export async function searchProblems(
  keyword: string,
  opts: { difficulty?: "EASY" | "MEDIUM" | "HARD"; topic?: string; limit?: number } = {},
): Promise<ProblemSummary[] | null> {
  const filters: Record<string, unknown> = {};
  if (keyword.trim()) filters.searchKeywords = keyword.trim().slice(0, 80);
  if (opts.difficulty) filters.difficulty = opts.difficulty;
  if (opts.topic) filters.tags = [opts.topic];

  const questions = await questionPage(Math.min(50, opts.limit ?? 25), 0, filters);
  if (questions !== null) return questions.map(toSummary);

  /**
   * GraphQL declined. Search the catalogue instead.
   *
   * Substring matching over three and a half thousand titles is not as good as
   * their relevance ranking, and it is enormously better than an error
   * message. The picker keeps working through a schema change, which is the
   * whole point of having a second source.
   */
  const all = await allProblems();
  if (all === null) return null;

  const needle = keyword.trim().toLowerCase();
  const wanted = opts.difficulty
    ? opts.difficulty.charAt(0) + opts.difficulty.slice(1).toLowerCase()
    : null;

  return all
    .filter((p) => (!needle || p.title.toLowerCase().includes(needle) || p.titleSlug.includes(needle)))
    .filter((p) => (!wanted || p.difficulty === wanted))
    // Shorter titles first: a search for "sum" should offer Two Sum before
    // Sum of Nodes with Even-Valued Grandparent.
    .sort((a, b) => a.title.length - b.title.length)
    .slice(0, Math.min(50, opts.limit ?? 25));
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
/**
 * The whole problem set, from the REST endpoint that has not changed in years.
 *
 * `/api/problems/all/` predates the GraphQL API, needs no auth, and returns
 * every problem with its number, slug, difficulty and acceptance rate in one
 * response. It is the reliable half of this integration: GraphQL has been
 * rewritten twice while this has sat still.
 *
 * So it backs the two things that must not depend on today's query shape —
 * finding a problem by its number, and searching when GraphQL declines.
 * Roughly 3,500 rows, fetched once and kept for the life of the instance,
 * because the list gains a handful of problems a week.
 */
interface Catalogue { at: number; items: ProblemSummary[] }
let catalogue: Catalogue | null = null;
const CATALOGUE_TTL_MS = 6 * 3_600_000;

const LEVELS: Record<number, string> = { 1: "Easy", 2: "Medium", 3: "Hard" };

async function allProblems(): Promise<ProblemSummary[] | null> {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS) return catalogue.items;

  try {
    const res = await proxyFetch("https://leetcode.com/api/problems/all/", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; SAGE/0.2)", referer: "https://leetcode.com" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) { lastGqlError = `problem list: HTTP ${res.status}`; return null; }

    const json = (await res.json()) as {
      stat_status_pairs?: {
        stat?: {
          frontend_question_id?: number;
          question__title?: string;
          question__title_slug?: string;
          total_acs?: number;
          total_submitted?: number;
        };
        difficulty?: { level?: number };
        paid_only?: boolean;
      }[];
    };

    const items: ProblemSummary[] = (json.stat_status_pairs ?? [])
      .map((row) => {
        const st = row.stat ?? {};
        const submitted = st.total_submitted ?? 0;
        return {
          title: st.question__title ?? "",
          titleSlug: st.question__title_slug ?? "",
          difficulty: LEVELS[row.difficulty?.level ?? 0] ?? "Medium",
          acRate: submitted > 0 ? Math.round(((st.total_acs ?? 0) / submitted) * 1000) / 10 : 0,
          paidOnly: !!row.paid_only,
          // This endpoint does not carry tags, and the picker does not show
          // them — the problem page fetches its own.
          topics: [],
          frontendId: String(st.frontend_question_id ?? ""),
        };
      })
      .filter((p) => p.titleSlug && p.frontendId);

    if (items.length === 0) { lastGqlError = "problem list came back empty"; return null; }
    catalogue = { at: Date.now(), items };
    return items;
  } catch (e) {
    lastGqlError = `problem list: ${(e as Error).message?.slice(0, 160)}`;
    return null;
  }
}

/**
 * Find a problem by its number.
 *
 * Straight lookup in the catalogue. The previous approach paged the GraphQL
 * list around the id and matched — which assumed the list comes back ordered
 * by number, and quietly returned nothing when it did not.
 */
export async function problemByNumber(id: number): Promise<ProblemSummary | null | "unavailable"> {
  const all = await allProblems();
  if (all === null) return "unavailable";
  return all.find((p) => p.frontendId === String(id)) ?? null;
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
