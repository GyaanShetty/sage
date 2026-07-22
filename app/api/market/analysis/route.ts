import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { getMarkets } from "@/infrastructure/markets";
import { getNews } from "@/infrastructure/news";
import { TZ, tzHour } from "@/lib/config";

export const maxDuration = 60;

function bucket(): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  return `${day}-${tzHour() < 13 ? "AM" : "PM"}`;
}

/**
 * AI market brief: indices + stocks + crypto + headlines → one tight
 * analysis. Generated at most twice a day (persisted per AM/PM bucket).
 */
export async function GET(req: Request) {
  const b = bucket();
  const { data: saved } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "market.analysis")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  const savedPayload = saved?.payload as { bucket?: string; text?: string } | null;
  if (savedPayload?.bucket === b && savedPayload.text) {
    return NextResponse.json({ ok: true, data: savedPayload.text });
  }

  const model = getModel("smart");
  if (!model) return NextResponse.json({ ok: true, data: null });

  const symbols = new URL(req.url).searchParams.get("symbols") ?? "^NSEI,^BSESN,RELIANCE.NS,TCS.NS,NVDA";
  const origin = new URL(req.url).origin;
  const [quotesRes, coins, headlines] = await Promise.all([
    fetch(`${origin}/api/market/quotes?symbols=${encodeURIComponent(symbols)}`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
    })
      .then((r) => r.json())
      .catch(() => null),
    getMarkets().catch(() => null),
    getNews().catch(() => null),
  ]);

  try {
    const { text } = await generateText({
      model,
      prompt: `You are SAGE's markets desk. Write a tight market analysis for Gyaan (Indian investor, IST timezone). 4 short paragraphs max, plain text with simple CAPS headers: PULSE (one-line read of the session), INDIA (Nifty/Sensex + the watchlist stocks), GLOBAL & CRYPTO (US names + BTC/ETH moves), WATCH (one specific thing to watch next session, tied to the headlines). Be concrete with numbers from the data. No advice disclaimers, no hedging filler.

Quotes: ${JSON.stringify(quotesRes?.data ?? [])}
Crypto: ${JSON.stringify((coins ?? []).map((c) => ({ s: c.symbol, p: c.price, chg: c.change24h })))}
Headlines: ${JSON.stringify((headlines ?? []).slice(0, 10).map((h: { title: string }) => h.title))}`,
    });
    await db.from("Event").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      type: "market.analysis",
      payload: { bucket: b, text },
    });
    return NextResponse.json({ ok: true, data: text });
  } catch {
    return NextResponse.json({ ok: true, data: savedPayload?.text ?? null });
  }
}
