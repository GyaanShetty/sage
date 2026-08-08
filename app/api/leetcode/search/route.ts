import { NextResponse } from "next/server";
import { searchProblems, problemByNumber, lastLeetcodeError } from "@/infrastructure/integrations/leetcode";

export const dynamic = "force-dynamic";

const DIFFICULTIES = new Set(["EASY", "MEDIUM", "HARD"]);

/**
 * Find a problem to solve.
 *
 * Accepts a name, a number, or a slug — the three ways anyone actually refers
 * to a LeetCode problem. A bare number goes down the id path, because
 * searching "1" by keyword returns everything with a 1 in its title and not
 * Two Sum.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const rawDifficulty = (url.searchParams.get("difficulty") ?? "").toUpperCase();
  const topic = url.searchParams.get("topic") ?? undefined;

  const difficulty = DIFFICULTIES.has(rawDifficulty)
    ? (rawDifficulty as "EASY" | "MEDIUM" | "HARD")
    : undefined;

  if (/^\d+$/.test(q)) {
    const hit = await problemByNumber(Number(q)).catch(() => null);
    return NextResponse.json({ ok: true, data: { problems: hit ? [hit] : [] } });
  }

  const problems = await searchProblems(q, {
    ...(difficulty ? { difficulty } : {}),
    ...(topic ? { topic } : {}),
  }).catch(() => null);

  // Null means LeetCode did not answer — say so rather than showing an empty
  // list, which reads as "no such problem" and is a different thing entirely.
  if (problems === null) {
    // Say what LeetCode actually objected to. "Something went wrong" is not
    // something anyone can act on, and this endpoint cannot be reached from
    // where it was written — the message is the only diagnosis available.
    const why = lastLeetcodeError();
    return NextResponse.json(
      {
        ok: false,
        error: "LeetCode didn't answer the search — their problem-list API has changed shape again.",
        detail: why ?? null,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, data: { problems } });
}
