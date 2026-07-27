import { NextResponse } from "next/server";
import { getDailyChallenge, getLeetStats } from "@/infrastructure/integrations/leetcode";

export const revalidate = 900;

/** LeetCode daily challenge + (optional) profile stats. Username from
 *  ?user= or LEETCODE_USERNAME env. */
export async function GET(req: Request) {
  const user = new URL(req.url).searchParams.get("user") ?? process.env.LEETCODE_USERNAME ?? "gyaanshetty";
  const [daily, stats] = await Promise.all([
    getDailyChallenge(),
    user ? getLeetStats(user) : Promise.resolve(null),
  ]);
  return NextResponse.json({ ok: true, data: { daily, stats, hasUser: !!user } });
}
