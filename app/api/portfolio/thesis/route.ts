import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { getPositions } from "@/core/portfolio/store";
import { getNews } from "@/infrastructure/news";

export const maxDuration = 45;

const schema = z.object({
  verdict: z.enum(["holding", "strained", "broken", "unclear"]).describe("Does the stated thesis still stand given price action and news?"),
  assessment: z.string().describe("2-3 sentences: what has changed since the thesis was written, and whether the position still earns its place."),
  question: z.string().describe("One pointed question to make the user re-examine the position honestly."),
});

/**
 * Thesis check-in: SAGE re-reads the user's own thesis for a position against
 * current P&L and headlines, then challenges it. Keeps convictions honest
 * instead of letting them quietly rot.
 */
export async function POST(req: Request) {
  const { id } = (await req.json()) as { id?: string };
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const url = new URL(req.url);
  const { positions } = await getPositions(url.origin, req.headers.get("cookie") ?? "");
  const p = positions.find((x) => x.id === id);
  if (!p) return NextResponse.json({ ok: false, error: "position not found" }, { status: 404 });
  if (!p.thesis?.trim()) {
    return NextResponse.json({ ok: false, error: "No thesis written for this position yet." }, { status: 400 });
  }

  const model = getModel("smart") ?? getModel("fast");
  if (!model) return NextResponse.json({ ok: false, error: "no model" }, { status: 400 });

  const news = await getNews(30).catch(() => []);
  const base = p.symbol.replace(/\.(NS|BO)$/, "").toLowerCase();
  const headlines = news.filter((n) => n.title.toLowerCase().includes(base)).slice(0, 5)
    .map((n) => `- ${n.title}`).join("\n");

  const { object } = await generateObject({
    model,
    schema,
    system:
      "You are SAGE, Gyaan's chief of staff, stress-testing an investment thesis he wrote himself. Be honest and specific — if the numbers contradict the thesis, say so plainly. If it still holds, say that too rather than inventing doubt. Never give financial advice; interrogate the reasoning.",
    prompt: [
      `Position: ${p.symbol} (${p.kind})`,
      `His thesis: "${p.thesis}"`,
      `Quantity ${p.qty} at average cost ${p.avgCost}. Current price ${p.price ?? "unknown"}.`,
      `Unrealised P&L: ${p.pnl?.toFixed(2) ?? "unknown"} (${p.pnlPct?.toFixed(1) ?? "?"}%). 24h move: ${p.change24h?.toFixed(1) ?? "?"}%.`,
      ``,
      `Recent headlines:\n${headlines || "(none found)"}`,
    ].join("\n"),
  });

  return NextResponse.json({ ok: true, data: { symbol: p.symbol, ...object } });
}
