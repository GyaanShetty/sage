import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { getNews } from "@/infrastructure/news";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";

export const maxDuration = 45;

const C_TYPE = "market.calendar";

const schema = z.object({
  events: z.array(
    z.object({
      date: z.string().describe("ISO date YYYY-MM-DD of the event. Only include events dated today or later."),
      title: z.string().describe("Short event name, e.g. 'Fed rate decision' or 'NVDA Q4 earnings'."),
      category: z.enum(["central-bank", "earnings", "economic-data", "policy", "crypto", "other"]),
      importance: z.enum(["high", "medium", "low"]),
      why: z.string().describe("One clause on why it matters for markets."),
    }),
  ).max(12),
});

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/**
 * Forward-looking market calendar. Rather than depending on a paid calendar
 * feed, SAGE reads the day's financial headlines and extracts the dated events
 * they reference — always fresh, always free.
 */
export async function GET(req: Request) {
  const day = today();
  const force = new URL(req.url).searchParams.get("refresh") === "1";

  if (!force) {
    const { data: cached } = await db
      .from("Event").select("payload")
      .eq("userId", DEFAULT_USER_ID).eq("type", C_TYPE)
      .contains("payload", { day }).limit(1).maybeSingle();
    if (cached?.payload) {
      const p = cached.payload as { events?: unknown[] };
      return NextResponse.json({ ok: true, data: { events: p.events ?? [], cached: true } });
    }
  }

  const model = getModel("fast");
  if (!model) return NextResponse.json({ ok: true, data: { events: [] } });

  const news = await getNews(40).catch(() => []);
  if (!news.length) return NextResponse.json({ ok: true, data: { events: [] } });

  let events: z.infer<typeof schema>["events"] = [];
  try {
    const { object } = await generateObject({
      model,
      schema,
      system:
        "You extract scheduled, forward-looking market events from news headlines. Only include events that are explicitly dated or clearly scheduled (rate decisions, earnings dates, data releases, policy deadlines, token unlocks). Never invent a date you cannot infer from the text. Skip anything already in the past. If nothing qualifies, return an empty list.",
      prompt: `Today is ${day}. Extract upcoming dated market events from these headlines:\n\n${news.map((n) => `- ${n.title}`).join("\n")}`,
    });
    events = object.events.filter((e) => e.date >= day).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    events = [];
  }

  const payload = { day, events };
  await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: C_TYPE, payload }).then(
    () => {}, () => {},
  );

  return NextResponse.json({ ok: true, data: { events, cached: false } });
}
