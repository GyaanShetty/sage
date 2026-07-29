import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { NEWS_SOURCES, getSourceHeadlines } from "@/infrastructure/news";
import { getMarkets } from "@/infrastructure/markets";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";
import { TZ, tzHour } from "@/lib/config";

export const maxDuration = 60;

const schema = z.object({
  summary: z.string().describe("2-3 sentence read of the morning: the big themes across the news"),
  connections: z.array(z.string()).describe("Each ties a news theme to Gyaan's own world — his markets/crypto, tasks, or day"),
  watch: z.array(z.string()).describe("Specific things to watch in the markets today, given the news"),
  actions: z.array(z.string()).describe("2-4 short, concrete suggested tasks for Gyaan"),
  spoken: z.string().describe("A SHORT spoken briefing (2-3 sentences, ~45 words) that SAGE says ALOUD — NOT a rehash of the text above. Lead with the single sharpest insight, then one concrete suggestion. Conversational, warm, direct, first person to Gyaan ('sir'). No lists, no markdown."),
});

/** Morning synthesis: reads across all the feeds + live markets + tasks + day
 *  and connects them into one insight brief. Cached per half-day to save quota. */
export async function GET() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const bucket = `${day}-${tzHour() < 13 ? "AM" : "PM"}`;

  const { data: cached } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "morning.synthesis")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  const cp = cached?.payload as { bucket?: string; data?: unknown } | null;
  if (cp?.bucket === bucket && cp.data) return NextResponse.json({ ok: true, data: cp.data });

  const [headlineSets, markets, events, { data: tasks }] = await Promise.all([
    Promise.all(Object.keys(NEWS_SOURCES).map(async (k) => ({ source: NEWS_SOURCES[k].source, items: await getSourceHeadlines(k, 4) }))),
    getMarkets().catch(() => null),
    listUpcomingEvents(4).catch(() => null),
    db.from("Task").select("title").eq("userId", DEFAULT_USER_ID).in("status", ["todo", "doing"]).limit(10),
  ]);

  const headlines = headlineSets
    .filter((s) => s.items.length)
    .map((s) => `${s.source}: ${s.items.map((i) => i.title).join(" | ")}`)
    .join("\n");

  const model = getModel("smart");
  if (!model || !headlines) {
    return NextResponse.json({ ok: true, data: { summary: "Feeds unavailable right now — try again shortly.", connections: [], watch: [], actions: [], spoken: "Morning, sir. The feeds are quiet just now — give it a moment and I'll have your read ready." } });
  }

  const system = `You are SAGE, Gyaan's British chief of staff. He has just read his morning news. Synthesize it and INTERLINK it with his own world — his crypto/markets, his open tasks, his day. Be specific, sharp, and useful; connect dots he might miss. No fluff.`;
  const prompt = `Today's headlines by source:\n${headlines}\n\nGyaan's crypto/markets: ${JSON.stringify((markets ?? []).slice(0, 6).map((c) => ({ s: c.symbol, chg24h: c.change24h })))}\nHis open tasks: ${JSON.stringify((tasks ?? []).map((t) => t.title))}\nToday's events: ${JSON.stringify((events ?? []).map((e) => e.summary))}`;

  // Try the smart model, then fall back to the fast one if it's busy/quota'd —
  // so the brief actually generates instead of showing "model busy".
  const run = (m: NonNullable<ReturnType<typeof getModel>>) => generateObject({ model: m, schema, system, prompt });
  try {
    let object;
    try {
      ({ object } = await run(model));
    } catch {
      const fast = getModel("fast");
      if (!fast) throw new Error("no fallback model");
      ({ object } = await run(fast));
    }
    await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "morning.synthesis", payload: { bucket, data: object } });
    return NextResponse.json({ ok: true, data: object });
  } catch {
    return NextResponse.json({ ok: true, data: { summary: "Couldn't synthesize just now (model busy). Your headlines are above.", connections: [], watch: [], actions: [], spoken: "I couldn't pull the full read together just now, sir — the headlines are on screen." } });
  }
}
