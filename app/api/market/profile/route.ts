import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";

/**
 * One name, in depth.
 *
 * Two sources, because no free one has all of it:
 *
 *  · Yahoo's chart endpoint gives price, the day's range, volume and the
 *    52-week range. Keyless and reliable — it is the only Yahoo endpoint that
 *    still answers without auth.
 *  · Alpha Vantage's OVERVIEW gives the valuation numbers Yahoo now puts
 *    behind a crumb: P/E, market cap, dividend yield, book value, margins.
 *
 * The split matters because the second one is rationed. The free tier is
 * twenty-five requests a DAY across the whole app, and the markets page alone
 * would burn that before lunch if every panel asked freely. So fundamentals
 * are cached for a day per symbol in the Event table and the route answers
 * from that cache on every hit but the first — and when the quota is gone it
 * says so and still returns the Yahoo half, rather than failing whole.
 */

export interface Profile {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  price: number;
  changePct: number;
  dayLow: number | null;
  dayHigh: number | null;
  low52: number | null;
  high52: number | null;
  /** Position in the 52-week range, 0–1. */
  band: number | null;
  volume: number | null;
  /** Present only when Alpha Vantage answered — see the note above. */
  fundamentals: Fundamentals | null;
  /** Why fundamentals are missing, when they are. */
  note?: string;
}

export interface Fundamentals {
  peRatio: number | null;
  marketCap: number | null;
  dividendYield: number | null;
  eps: number | null;
  bookValue: number | null;
  profitMargin: number | null;
  sector: string | null;
  industry: string | null;
  /** The day this was fetched, so the panel can say how old it is. */
  asOf: string;
}

const C_TYPE = "market.fundamentals";
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Yahoo's half: free, keyless, always tried. */
async function quote(symbol: string) {
  const res = await proxyFetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0" } },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { chart?: { result?: { meta?: Record<string, number | string> }[] } };
  return j.chart?.result?.[0]?.meta ?? null;
}

/** Alpha Vantage's half, at most once a day per symbol. */
async function fundamentals(symbol: string, day: string): Promise<{ f: Fundamentals | null; note?: string }> {
  const { data: cached } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", C_TYPE)
    .contains("payload", { symbol, day }).limit(1).maybeSingle();
  if (cached?.payload) {
    const p = cached.payload as { f?: Fundamentals };
    if (p.f) return { f: p.f };
  }

  const key = process.env.ALPHAVANTAGE_KEY;
  if (!key) return { f: null, note: "Set ALPHAVANTAGE_KEY for valuation numbers." };

  try {
    // OVERVIEW wants the plain ticker; Alpha Vantage does not use Yahoo's
    // .NS/.BO suffixes and returns an empty object for them.
    const av = symbol.replace(/\.(NS|BO|BSE)$/, symbol.endsWith(".NS") || symbol.endsWith(".BO") ? ".BSE" : "");
    const res = await proxyFetch(
      `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(av)}&apikey=${key}`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!res.ok) return { f: null, note: "Valuation feed unreachable." };
    const j = (await res.json()) as Record<string, string>;

    // Alpha Vantage answers 200 with a "Note"/"Information" body when the
    // daily quota is spent, which is the case worth naming rather than
    // rendering as "no data".
    if (j.Note || j.Information) return { f: null, note: "Daily valuation quota reached — back tomorrow." };
    if (!j.Symbol) return { f: null, note: "No valuation data for that listing." };

    const f: Fundamentals = {
      peRatio: num(j.PERatio),
      marketCap: num(j.MarketCapitalization),
      dividendYield: num(j.DividendYield),
      eps: num(j.EPS),
      bookValue: num(j.BookValue),
      profitMargin: num(j.ProfitMargin),
      sector: j.Sector || null,
      industry: j.Industry || null,
      asOf: day,
    };
    await db.from("Event").insert({
      id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: C_TYPE, payload: { symbol, day, f },
    }).then(({ error }) => { if (error) console.warn("[profile] cache write failed:", error.message); });
    return { f };
  } catch {
    return { f: null, note: "Valuation feed unreachable." };
  }
}

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol")?.trim();
  if (!symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const [m, fund] = await Promise.all([quote(symbol).catch(() => null), fundamentals(symbol, day)]);

  if (!m || typeof m.regularMarketPrice !== "number") {
    return NextResponse.json({ ok: false, error: "Couldn't reach the price feed for that symbol." }, { status: 502 });
  }

  const price = m.regularMarketPrice as number;
  const low = m.fiftyTwoWeekLow as number | undefined;
  const high = m.fiftyTwoWeekHigh as number | undefined;

  const data: Profile = {
    symbol: (m.symbol as string) ?? symbol,
    name: (m.longName as string) || (m.shortName as string) || symbol,
    currency: (m.currency as string) ?? "",
    exchange: (m.fullExchangeName as string) ?? "",
    price,
    changePct: (m.regularMarketChangePercent as number) ?? 0,
    dayLow: (m.regularMarketDayLow as number) ?? null,
    dayHigh: (m.regularMarketDayHigh as number) ?? null,
    low52: low ?? null,
    high52: high ?? null,
    band: typeof low === "number" && typeof high === "number" && high > low
      ? Math.min(1, Math.max(0, (price - low) / (high - low))) : null,
    volume: (m.regularMarketVolume as number) ?? null,
    fundamentals: fund.f,
    ...(fund.note ? { note: fund.note } : {}),
  };
  return NextResponse.json({ ok: true, data });
}
