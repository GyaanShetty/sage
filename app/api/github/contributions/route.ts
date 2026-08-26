import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Five minutes, not an hour.
 *
 * This was `revalidate = 3600` *and* a one-hour `cache-control`, which stack:
 * a commit could be on github.com for the best part of two hours before it
 * showed here. GitHub's own calendar updates within minutes, so the grid
 * looked simply wrong rather than merely delayed.
 */
export const revalidate = 300;

export interface ContributionDay {
  /** ISO date. Was dropped entirely, so no cell could say which day it was. */
  date: string;
  count: number;
  /** GitHub's own 0–4 banding, not a value derived from this user's max. */
  level: number;
}

export interface Contributions {
  total: number;
  weeks: ContributionDay[][];
  max: number;
}

/** The GitHub contribution calendar (last ~year) via GraphQL. */
export async function GET() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ ok: true, data: null });

  /**
   * Ask for the date and the level, which the old query left behind.
   *
   * `contributionLevel` is the banding GitHub renders with. Recomputing shades
   * from this user's own maximum — which is what the dashboard did — produces
   * a grid that is internally consistent and matches github.com on no day at
   * all: one busy afternoon rescales the entire year.
   */
  const query = `query {
    viewer {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { contributionCount date contributionLevel } }
        }
      }
    }
  }`;

  // GitHub's enum → the 0-4 the grid draws with.
  const LEVELS: Record<string, number> = {
    NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4,
  };

  try {
    const res = await proxyFetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) {
      // Say why. A silent null here is indistinguishable from "no token" and
      // from "no contributions", which is three very different fixes.
      const detail = await res.text().catch(() => "");
      return NextResponse.json({
        ok: true, data: null,
        error: `GitHub ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`,
      });
    }
    const json = await res.json();
    const cal = json?.data?.viewer?.contributionsCollection?.contributionCalendar;
    if (!cal) return NextResponse.json({ ok: true, data: null });
    type Day = { contributionCount: number; date: string; contributionLevel: string };
    const weeks: ContributionDay[][] = cal.weeks.map((w: { contributionDays: Day[] }) =>
      w.contributionDays.map((d) => ({
        date: d.date,
        count: d.contributionCount,
        level: LEVELS[d.contributionLevel] ?? 0,
      })),
    );
    const max = Math.max(1, ...weeks.flat().map((d) => d.count));
    const data: Contributions = { total: cal.totalContributions, weeks, max };
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ ok: true, data: null });
  }
}
