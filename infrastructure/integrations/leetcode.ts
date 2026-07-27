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

export interface LeetStats {
  username: string;
  ranking: number | null;
  solved: { all: number; easy: number; medium: number; hard: number };
  streak: number;
  totalActiveDays: number;
  todaySolved: number;
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

  // today's solved count from the submission calendar (epoch-second → count)
  let todaySolved = 0;
  try {
    const cal = JSON.parse(m.userCalendar?.submissionCalendar ?? "{}") as Record<string, number>;
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    for (const [ts, count] of Object.entries(cal)) {
      if (Number(ts) >= startOfDay) todaySolved += count;
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
  };
}
