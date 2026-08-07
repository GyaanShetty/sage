import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { webSearch, type WebResult } from "@/infrastructure/search/tavily";
import { getSourceHeadlines, NEWS_SOURCES } from "@/infrastructure/news";
import { getMarkets } from "@/infrastructure/markets";
import { listHoldings } from "@/core/portfolio/store";
import { OWNER } from "@/lib/config";

/**
 * Research a topic properly, rather than answering from memory.
 *
 * The distinction that matters: this reads live sources and cites them. An
 * answer with no URL behind it is the model's recollection, and for anything
 * that moves — a market, a company, a technology this month — recollection is
 * the wrong tool. Every claim here comes back with somewhere it came from.
 *
 * It also grounds the finding in Gyaan's own position: what he holds and what
 * he is already working on, so the brief ends in "and therefore" rather than a
 * neutral encyclopedia entry.
 */

const TYPE = "research.brief";

export const briefSchema = z.object({
  headline: z.string().describe("One line: the answer, not the topic restated"),
  summary: z.string().describe("3-5 sentences of what is actually going on"),
  keyPoints: z.array(z.string()).describe("The specific facts worth remembering, each standing alone"),
  soWhat: z.array(z.string()).describe("How this touches Gyaan's holdings, work or plans. Empty if it genuinely does not."),
  uncertainty: z.string().describe("What is contested, unknown, or where the sources disagree. Say so plainly."),
  followUps: z.array(z.string()).describe("2-4 sharper questions worth asking next"),
  actions: z.array(z.string()).describe("0-3 concrete things to do, phrased as tasks"),
});

export interface ResearchBrief extends z.infer<typeof briefSchema> {
  id: string;
  topic: string;
  at: string;
  sources: { title: string; url: string }[];
}

/** Pull the raw material: web, feeds, and his own position. */
async function gather(topic: string) {
  const feedKeys = Object.keys(NEWS_SOURCES).slice(0, 4);
  const [web, feeds, markets, holdings] = await Promise.all([
    webSearch(topic, 6).catch(() => null),
    Promise.all(feedKeys.map((k) => getSourceHeadlines(k, 5).catch(() => []))),
    getMarkets().catch(() => null),
    listHoldings().catch(() => []),
  ]);
  return { web, headlines: feeds.flat(), markets, holdings };
}

export async function research(topic: string): Promise<ResearchBrief | { error: string }> {
  const clean = topic.trim().slice(0, 300);
  if (!clean) return { error: "Nothing to research." };

  const model = getModel("smart") ?? getModel("fast");
  if (!model) return { error: "No model available right now." };

  const { web, headlines, markets, holdings } = await gather(clean);

  // Without web results this would be recall dressed up as research. Say that
  // rather than producing a confident brief with nothing under it.
  const sources: WebResult[] = web ?? [];
  const grounded = sources.length > 0;

  const relatedHeadlines = headlines
    .filter((h) => clean.toLowerCase().split(/\s+/).some((w) => w.length > 4 && h.title.toLowerCase().includes(w)))
    .slice(0, 8);

  const system = `You are SAGE, ${OWNER}'s chief of staff, writing a research brief.

Rules:
- Use the supplied sources. Where you rely on general knowledge instead, say so in "uncertainty".
- Specific over general. Numbers, names, dates. "Significant growth" is not a fact; "revenue up 41% to $2.1bn in Q2" is.
- "soWhat" must reference his actual holdings or work, or be empty. Do not invent a connection to look useful.
- No hedging filler, no "it is important to note".${grounded ? "" : "\n- You have NO live sources. Be explicit in `uncertainty` that this is unverified recall."}`;

  const prompt = [
    `Topic: ${clean}`,
    sources.length
      ? `\nWeb sources:\n${sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.content.slice(0, 700)}`).join("\n\n")}`
      : "\nWeb sources: none available.",
    relatedHeadlines.length ? `\nRelated headlines: ${relatedHeadlines.map((h) => h.title).join(" | ")}` : "",
    holdings.length
      ? `\nHis holdings: ${holdings.slice(0, 15).map((h) => `${h.symbol}×${h.qty}`).join(", ")}`
      : "",
    markets?.length ? `\nMarket moves: ${markets.slice(0, 6).map((c) => `${c.symbol} ${c.change24h}%`).join(", ")}` : "",
  ].join("\n");

  // The smart model is the one most likely to be quota'd, and falling back is
  // better than telling him to ask a narrower question when the question was
  // never the problem.
  const run = (m: NonNullable<ReturnType<typeof getModel>>) =>
    generateObject({ model: m, schema: briefSchema, system, prompt });

  try {
    let object: z.infer<typeof briefSchema>;
    try {
      ({ object } = await run(model));
    } catch (first) {
      const fast = getModel("fast");
      if (!fast || fast === model) throw first;
      ({ object } = await run(fast));
    }
    const brief: ResearchBrief = {
      ...object,
      id: crypto.randomUUID(),
      topic: clean,
      at: new Date().toISOString(),
      sources: sources.map((s) => ({ title: s.title, url: s.url })).slice(0, 8),
    };
    await db.from("Event").insert({
      id: brief.id, userId: DEFAULT_USER_ID, type: TYPE, payload: brief,
    });
    return brief;
  } catch (err) {
    // Say what actually went wrong. "Try a narrower question" was advice for a
    // problem that was usually not the question at all — most often an
    // exhausted key or a missing search key — and it sent him in circles.
    const msg = err instanceof Error ? err.message : String(err);
    if (/quota|rate.?limit|429|exhaust/i.test(msg)) {
      return { error: "Every Gemini key is rate-limited right now. Give it a few minutes." };
    }
    if (/schema|parse|validation/i.test(msg)) {
      return { error: "The model returned something malformed. Worth trying once more." };
    }
    return {
      error: grounded
        ? `Research failed: ${msg.slice(0, 160)}`
        : "Research failed, and there are no web sources either — set TAVILY_API_KEY (free tier) so SAGE can actually read something.",
    };
  }
}

export async function listBriefs(limit = 20): Promise<ResearchBrief[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => r.payload as ResearchBrief).filter((b) => b?.topic);
}

export async function getBrief(id: string): Promise<ResearchBrief | null> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("id", id)
    .maybeSingle();
  return (data?.payload as ResearchBrief) ?? null;
}
