import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { webSearch } from "@/infrastructure/search/tavily";
import { recallMemories, renderMemoryBlock } from "@/core/memory/recall";

export const maxDuration = 60;

const schema = z.object({
  overview: z.string().describe("2-3 sentences on the company and this role"),
  recentNews: z.array(z.string()).describe("Recent, specific developments worth mentioning"),
  likelyQuestions: z.array(z.string()).describe("5-7 likely interview questions for this role"),
  yourFit: z.string().describe("How Gyaan's background fits, from his memory; honest about gaps"),
  tips: z.array(z.string()).describe("2-4 concrete prep tips"),
});

/** Interview prep for a company+role: fresh news + likely questions + fit. */
export async function POST(req: Request) {
  const { company, role } = (await req.json()) as { company?: string; role?: string };
  if (!company) return NextResponse.json({ ok: false, error: "company required" }, { status: 400 });

  const model = getModel("smart");
  if (!model) return NextResponse.json({ ok: false, error: "no model" }, { status: 400 });

  const [news, memories] = await Promise.all([
    webSearch(`${company} news ${role ?? ""} 2025`, 5).catch(() => null),
    recallMemories(`${company} ${role ?? ""} skills experience background`).catch(() => []),
  ]);

  const { object } = await generateObject({
    model,
    schema,
    system: `You are SAGE, prepping Gyaan for an interview. Be specific and genuinely useful — no generic filler. Use the fresh web results for recent news; use his memory for the fit (be honest about gaps).`,
    prompt: `Company: ${company}\nRole: ${role ?? "unspecified"}\n\nFresh web results:\n${(news ?? []).map((n) => `- ${n.title}: ${n.content?.slice(0, 200) ?? ""}`).join("\n") || "(none)"}\n${renderMemoryBlock(memories)}`,
  });

  return NextResponse.json({ ok: true, data: object });
}
