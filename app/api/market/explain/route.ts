import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { getNews } from "@/infrastructure/news";

export const maxDuration = 45;

interface Profile {
  name: string;
  price: number | null;
  changePct: number | null;
  currency: string;
  exchange: string;
  marketCap: number | null;
  fiftyTwoHigh: number | null;
  fiftyTwoLow: number | null;
}

/** Pull a quick fundamentals snapshot from Yahoo's keyless chart endpoint. */
async function profile(symbol: string): Promise<Profile | null> {
  try {
    const res = await proxyFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`,
      { signal: AbortSignal.timeout(9000), headers: { "user-agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      chart?: { result?: { meta?: Record<string, unknown>; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const m = j.chart?.result?.[0]?.meta ?? {};
    const closes = (j.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((v): v is number => typeof v === "number");
    const price = typeof m.regularMarketPrice === "number" ? m.regularMarketPrice : null;
    const prev = typeof m.chartPreviousClose === "number" ? m.chartPreviousClose : null;
    return {
      name: (m.shortName as string) ?? (m.longName as string) ?? symbol.toUpperCase(),
      price,
      changePct: price != null && prev ? ((price - prev) / prev) * 100 : null,
      currency: (m.currency as string) ?? "",
      exchange: (m.fullExchangeName as string) ?? (m.exchangeName as string) ?? "",
      marketCap: null,
      fiftyTwoHigh: closes.length ? Math.max(...closes) : null,
      fiftyTwoLow: closes.length ? Math.min(...closes) : null,
    };
  } catch {
    return null;
  }
}

/**
 * "Explain this ticker" — a plain-English brief on what a company or coin
 * actually is, how it's trading, and what the recent headlines say.
 */
export async function POST(req: Request) {
  const { symbol, context } = (await req.json()) as { symbol?: string; context?: string };
  if (!symbol?.trim()) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  const sym = symbol.trim().toUpperCase();

  const model = getModel("fast");
  if (!model) return NextResponse.json({ ok: false, error: "no model" }, { status: 400 });

  const [p, news] = await Promise.all([
    profile(symbol.trim()),
    getNews(30).catch(() => []),
  ]);

  const base = sym.replace(/\.(NS|BO)$/, "").toLowerCase();
  const headlines = news
    .filter((n) => n.title.toLowerCase().includes(base) || (p?.name && n.title.toLowerCase().includes(p.name.split(" ")[0].toLowerCase())))
    .slice(0, 5)
    .map((n) => `- ${n.title} (${n.source})`)
    .join("\n");

  const facts = p
    ? `Name: ${p.name}\nExchange: ${p.exchange}\nPrice: ${p.price ?? "?"} ${p.currency}\nToday: ${p.changePct?.toFixed(2) ?? "?"}%\n52w range: ${p.fiftyTwoLow?.toFixed(2) ?? "?"} – ${p.fiftyTwoHigh?.toFixed(2) ?? "?"}`
    : "(no live quote available)";

  const { text } = await generateText({
    model,
    system:
      "You are SAGE, briefing Gyaan on a ticker. Give: (1) one sentence on what this company/asset actually does or is, in plain English; (2) how it's trading right now versus its 52-week range; (3) what the recent headlines suggest, if any; (4) one honest line on the main risk. Be concrete and brief — under 130 words total. No markdown, no preamble, no financial advice disclaimers.",
    prompt: `Ticker: ${sym}\n\n${facts}\n\nRecent headlines:\n${headlines || "(none found)"}\n\n${context ? `The user's context: ${context}` : ""}`,
  });

  return NextResponse.json({ ok: true, data: { symbol: sym, profile: p, explanation: text.trim() } });
}
