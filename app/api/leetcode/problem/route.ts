import { NextResponse } from "next/server";
import { getProblem, getDailyChallenge } from "@/infrastructure/integrations/leetcode";

export const revalidate = 3600;

/** One problem's statement. No slug = today's daily. */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug");

  const titleSlug = slug ?? (await getDailyChallenge().catch(() => null))?.titleSlug;
  if (!titleSlug) return NextResponse.json({ ok: false, error: "Couldn't work out which problem you meant." }, { status: 400 });

  const problem = await getProblem(titleSlug).catch(() => null);
  if (!problem) return NextResponse.json({ ok: false, error: "LeetCode didn't return that problem." }, { status: 404 });

  return NextResponse.json({ ok: true, data: problem });
}
