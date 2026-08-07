import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { getPositions } from "@/core/portfolio/store";
import { summarize } from "@/core/finance/expenses";
import { recallMemories, renderMemoryBlock } from "@/core/memory/recall";
import { HUMAN_RULES, OWNER } from "@/lib/config";

export const maxDuration = 60;

/** Financial mentor — advice grounded in the user's real portfolio, spending,
 *  and goals. Ask a question, or omit for a proactive monthly read. */
export async function POST(req: Request) {
  const { question } = (await req.json().catch(() => ({}))) as { question?: string };
  const origin = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";

  const [{ positions, totals }, spend, memories] = await Promise.all([
    getPositions(origin, cookie).catch(() => ({ positions: [], totals: { value: 0, cost: 0, pnl: 0, pnlPct: 0 } })),
    summarize(30).catch(() => ({ total: 0, byCategory: {}, recurring: [] })),
    recallMemories(question || "money income budget goals investing risk").catch(() => []),
  ]);

  const model = getModel("smart");
  if (!model) return NextResponse.json({ ok: false, error: "no model" }, { status: 400 });

  const context = `Portfolio (value ₹${Math.round(totals.value)}, cost ₹${Math.round(totals.cost)}, P&L ₹${Math.round(totals.pnl)} / ${totals.pnlPct.toFixed(1)}%): ${JSON.stringify(positions.map((p) => ({ s: p.symbol, val: Math.round(p.value ?? 0), pnlPct: p.pnlPct?.toFixed(0), thesis: p.thesis })))}
Last 30d spend ₹${Math.round(spend.total)} by category: ${JSON.stringify(spend.byCategory)}. Subscriptions: ${JSON.stringify(spend.recurring)}.
${renderMemoryBlock(memories)}`;

  const { text } = await generateText({
    model,
    system: `You are SAGE acting as ${OWNER}'s sharp, honest financial mentor. Ground everything in his ACTUAL numbers below. Be specific and practical — real figures, concrete moves, honest about risk. He's a student in India (₹), early in his journey. ${HUMAN_RULES} Keep it tight: a few punchy paragraphs, not an essay. No disclaimers-as-filler.`,
    prompt: question
      ? `${context}\n\nHis question: ${question}`
      : `${context}\n\nGive him a short monthly financial read: how he's doing, one thing to watch on his book, one thing about his spending, and one concrete next move.`,
  });

  return NextResponse.json({ ok: true, data: { answer: text } });
}
