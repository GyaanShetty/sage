import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { getNews } from "@/infrastructure/news";
import { getMarkets } from "@/infrastructure/markets";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ } from "@/lib/config";

export const maxDuration = 45;

const N_TYPE = "market.narrative";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/**
 * "Why did the market move today" — one plain-English narrative stitched from
 * index moves, sector rotation, crypto and the day's headlines. Cached once
 * per day so repeat visits are instant and free.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const day = today();
  const force = url.searchParams.get("refresh") === "1";

  if (!force) {
    const { data: cached } = await db
      .from("Event").select("payload")
      .eq("userId", DEFAULT_USER_ID).eq("type", N_TYPE)
      .contains("payload", { day }).limit(1).maybeSingle();
    if (cached?.payload) {
      return NextResponse.json({ ok: true, data: { ...(cached.payload as object), cached: true } });
    }
  }

  const model = getModel("smart") ?? getModel("fast");
  if (!model) return NextResponse.json({ ok: false, error: "no model" }, { status: 400 });

  const origin = url.origin;
  const cookie = req.headers.get("cookie") ?? "";
  const [indices, sectors, coins, news] = await Promise.all([
    fetch(`${origin}/api/market/quotes?symbols=^NSEI,^BSESN,^GSPC,^IXIC`, { headers: { cookie } })
      .then((r) => r.json()).then((j) => j.data ?? []).catch(() => []),
    fetch(`${origin}/api/market/sectors`, { headers: { cookie } })
      .then((r) => r.json()).then((j) => j.data).catch(() => null),
    getMarkets().catch(() => []),
    getNews(25).catch(() => []),
  ]);

  const idxLine = (indices as { symbol: string; name: string; changePct: number }[])
    .map((q) => `${q.name ?? q.symbol}: ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%`).join(", ");
  const secLine = sectors
    ? `Leaders: ${(sectors.leaders ?? []).map((s: { label: string; changePct: number }) => `${s.label} ${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(1)}%`).join(", ")}. ` +
      `Laggards: ${(sectors.laggards ?? []).map((s: { label: string; changePct: number }) => `${s.label} ${s.changePct?.toFixed(1)}%`).join(", ")}. ` +
      `Breadth: ${sectors.breadth?.toFixed(0) ?? "?"}% of sectors green.`
    : "(sector data unavailable)";
  const coinLine = (coins ?? []).map((c) => `${c.symbol} ${c.change24h >= 0 ? "+" : ""}${c.change24h.toFixed(1)}%`).join(", ");
  const headlines = news.slice(0, 12).map((n) => `- ${n.title}`).join("\n");

  const { text } = await generateText({
    model,
    system:
      "You are SAGE, giving Gyaan the day's market read. Write 3 short paragraphs: (1) what actually happened across Indian and US indices; (2) where the rotation was — which sectors worked and which didn't, and what that implies; (3) crypto and the one headline that most explains the tape. Connect cause to effect where the evidence supports it, and say plainly when a move has no clean explanation. Conversational, sharp, no jargon dumps, no markdown, no disclaimers.",
    prompt: `Indices: ${idxLine || "(unavailable)"}\n\nSectors: ${secLine}\n\nCrypto: ${coinLine || "(unavailable)"}\n\nHeadlines:\n${headlines || "(none)"}`,
  });

  const payload = { day, narrative: text.trim(), at: new Date().toISOString() };
  await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: N_TYPE, payload }).then(
    () => {}, () => {},
  );

  return NextResponse.json({ ok: true, data: { ...payload, cached: false } });
}
