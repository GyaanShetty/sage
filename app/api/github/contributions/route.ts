import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const revalidate = 3600;

export interface Contributions {
  total: number;
  weeks: number[][]; // each week = 7 day-counts
  max: number;
}

/** The GitHub contribution calendar (last ~year) via GraphQL. */
export async function GET() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ ok: true, data: null });

  const query = `query { viewer { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { contributionCount } } } } } }`;

  try {
    const res = await proxyFetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return NextResponse.json({ ok: true, data: null });
    const json = await res.json();
    const cal = json?.data?.viewer?.contributionsCollection?.contributionCalendar;
    if (!cal) return NextResponse.json({ ok: true, data: null });
    const weeks: number[][] = cal.weeks.map((w: { contributionDays: { contributionCount: number }[] }) =>
      w.contributionDays.map((d) => d.contributionCount),
    );
    const max = Math.max(1, ...weeks.flat());
    const data: Contributions = { total: cal.totalContributions, weeks, max };
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ ok: true, data: null });
  }
}
