import { NextResponse } from "next/server";
import { fetchQuote, type Quote } from "@/infrastructure/markets/quotes";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 16);
  if (!symbols.length) return NextResponse.json({ ok: false, error: "symbols required" }, { status: 400 });
  const quotes = (await Promise.all(symbols.map(fetchQuote))).filter((q): q is Quote => q !== null);
  return NextResponse.json({ ok: true, data: quotes });
}
