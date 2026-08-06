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
